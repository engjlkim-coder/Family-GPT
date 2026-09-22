import { client, getVectorStoreId } from "./_vectorStore.js";

/*
 * Family GPT 3.3 - unified tool routing
 *
 * Tools:
 *   1) web_search  : current/latest information, weather, news, prices, etc.
 *   2) file_search : registered knowledge files in the automatic Vector Store
 *
 * The model decides which tool(s) are needed for each question.
 * Attached images/files are kept in the conversation input so follow-up
 * questions can continue to refer to them.
 */

function buildUserContent(message) {
  const parts = [];

  if (message?.content) {
    parts.push({
      type: "input_text",
      text: String(message.content)
    });
  }

  // Keep attached images available to later turns when the frontend includes
  // them in the history object.
  for (const src of (Array.isArray(message?.images) ? message.images : []).slice(0, 4)) {
    if (typeof src === "string" && src.startsWith("data:image/")) {
      parts.push({
        type: "input_image",
        image_url: src,
        detail: "high"
      });
    }
  }

  // Text/code attachments (HTML, CSS, JS, JSON, TXT, MD, CSV, etc.)
  // are passed directly to the model for structural/code analysis.
  for (const file of (Array.isArray(message?.files) ? message.files : []).slice(0, 6)) {
    if (file && typeof file.content === "string") {
      const name = String(file.name || "첨부파일");

      parts.push({
        type: "input_text",
        text:
          `\n===== 첨부 파일 시작 =====\n` +
          `파일명: ${name}\n` +
          `\n${file.content}\n` +
          `===== 첨부 파일 끝 =====\n`
      });
    }
  }

  return parts.length
    ? parts
    : [{ type: "input_text", text: "" }];
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-16)
    .filter(x => x && (x.role === "user" || x.role === "assistant"))
    .map(x => {
      if (x.role === "assistant") {
        // Responses API assistant history must use output_text,
        // not input_text.
        return {
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: String(x.content || "")
            }
          ]
        };
      }

      return {
        role: "user",
        content: buildUserContent(x)
      };
    });
}

function buildInstructions() {
  return `
당신은 개인용 AI 비서입니다.

[도구 선택]
필요한 경우에만 도구를 사용하세요.

1. 최신성/현재성이 중요한 질문은 web_search를 사용하세요.
   예: 현재 날씨, 오늘/최근 뉴스, 현재 주가·환율·가격,
   최신 제품/정책/기술 정보, "지금", "오늘", "최신", "현재" 등이 포함된 질문.

2. 등록된 가족/개인 지식자료에서 답을 찾아야 하는 질문은 file_search를 사용하세요.

3. 일반적인 지식이나 사용자가 직접 첨부한 자료를 분석하는 질문은
   불필요한 웹검색을 하지 말고 직접 답하세요.

4. 한 질문에서 최신 웹정보와 등록 지식자료가 모두 필요하면
   두 도구를 함께 사용할 수 있습니다.

[첨부파일]
- 이미지가 첨부되면 이미지 자체를 분석하세요.
- HTML/CSS/JavaScript/JSON/XML/SVG/TXT/MD/CSV 등의 코드·텍스트 파일이 첨부되면
  파일의 실제 내용을 기준으로 구조와 오류를 분석하세요.
- 사용자가 수정해 달라고 하면 원인을 먼저 파악한 뒤 수정 코드를 제시하세요.
- 사용자가 "전체 파일", "수정본", "다운로드할 파일" 등을 요청하면
  가능한 한 완전한 파일 형태의 코드를 제공하세요.
- 첨부파일의 내용과 관련된 후속 질문에서는 이전에 첨부된 자료를 계속 참조하세요.
- 파일에 없는 내용을 파일에서 확인했다고 말하지 마세요.

[최신 정보]
web_search를 사용했다면 검색 결과에 근거하여 답하고,
가능하면 답변에서 정보의 기준 시점과 출처를 명확히 하세요.
현재 날씨처럼 시간에 민감한 정보는 검색 결과의 시점을 확인하세요.

[대화]
이전 대화의 맥락을 유지하세요.
사용자의 질문에 필요한 정보만 간결하고 정확하게 답하세요.
`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY 환경변수가 없습니다."
    });
  }

  try {
    const {
      model,
      question,
      history = [],
      images = [],
      files = []
    } = req.body || {};

    const current = {
      role: "user",
      content: question || "첨부한 자료를 분석해 주세요.",
      images,
      files
    };

    const input = [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: buildInstructions()
          }
        ]
      },

      ...normalizeHistory(history),

      {
        role: "user",
        content: buildUserContent(current)
      }
    ];

    // Vector Store is created/reused automatically.
    const vectorStoreId = await getVectorStoreId();

    /*
     * Both tools are exposed to the model.
     * The model decides whether to use:
     *   - web_search
     *   - file_search
     *   - both
     *   - neither
     */
    const tools = [
      {
        type: "web_search"
      },
      {
        type: "file_search",
        vector_store_ids: [vectorStoreId],
        max_num_results: 8
      }
    ];

    const response = await client.responses.create({
      model: model || "gpt-5.6",
      input,
      tools
    });

    return res.status(200).json({
      answer: response.output_text || "응답이 없습니다.",
      vector_store_id: vectorStoreId
    });

  } catch (e) {
    console.error(e);

    return res.status(500).json({
      error: e?.message || "OpenAI API 오류"
    });
  }
}
