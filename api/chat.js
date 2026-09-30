import { client, getVectorStoreId } from "./_vectorStore.js";

/*
 * Family GPT 3.5 - unified tool routing + file generation
 *
 * Tools:
 *   1) web_search  : current/latest information, weather, news, prices, etc.
 *   2) file_search : registered knowledge files in the automatic Vector Store
 *
 * Added in 3.5:
 *   - HTML/CSS/JS/JSON/CSV/MD/TXT file generation
 *   - PDF file generation
 *   - Image generation
 *   - files[] response for index.html download UI
 *
 * Existing features are preserved:
 *   - automatic Vector Store
 *   - web_search
 *   - file_search
 *   - attached images
 *   - attached text/code files
 *   - follow-up questions
 */

function buildUserContent(message) {
  const parts = [];

  if (message?.content) {
    parts.push({
      type: "input_text",
      text: String(message.content)
    });
  }

  // Keep attached images available to later turns.
  for (const src of (
    Array.isArray(message?.images)
      ? message.images
      : []
  ).slice(0, 4)) {
    if (
      typeof src === "string" &&
      src.startsWith("data:image/")
    ) {
      parts.push({
        type: "input_image",
        image_url: src,
        detail: "high"
      });
    }
  }

  // Text/code attachments
  // HTML, CSS, JS, JSON, TXT, MD, CSV, etc.
  for (const file of (
    Array.isArray(message?.files)
      ? message.files
      : []
  ).slice(0, 6)) {
    if (
      file &&
      typeof file.content === "string"
    ) {
      const name = String(
        file.name || "첨부파일"
      );

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
    : [
        {
          type: "input_text",
          text: ""
        }
      ];
}


function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-16)
    .filter(
      x =>
        x &&
        (
          x.role === "user" ||
          x.role === "assistant"
        )
    )
    .map(x => {

      if (x.role === "assistant") {
        /*
         * Responses API assistant history must use
         * output_text, not input_text.
         */
        return {
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: String(
                x.content || ""
              )
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
   예:
   현재 날씨, 오늘/최근 뉴스,
   현재 주가·환율·가격,
   최신 제품/정책/기술 정보,
   "지금", "오늘", "최신", "현재" 등이 포함된 질문.

2. 등록된 가족/개인 지식자료에서 답을 찾아야 하는 질문은
   file_search를 사용하세요.

3. 일반적인 지식이나 사용자가 직접 첨부한 자료를 분석하는 질문은
   불필요한 웹검색을 하지 말고 직접 답하세요.

4. 한 질문에서 최신 웹정보와 등록 지식자료가 모두 필요하면
   두 도구를 함께 사용할 수 있습니다.


[첨부파일]

- 이미지가 첨부되면 이미지 자체를 분석하세요.

- HTML/CSS/JavaScript/JSON/XML/SVG/TXT/MD/CSV 등의
  코드·텍스트 파일이 첨부되면 파일의 실제 내용을 기준으로
  구조와 오류를 분석하세요.

- 사용자가 수정해 달라고 하면 원인을 먼저 파악한 뒤
  수정 코드를 제시하세요.

- 사용자가 "전체 파일", "수정본", "다운로드할 파일"
  등을 요청하면 가능한 한 완전한 파일 형태의 코드를 제공하세요.

- HTML 파일을 요청하면 반드시 완전한 HTML 문서를
  하나의 코드블록으로 제공합니다.

- JavaScript 파일을 요청하면 실행 가능한 전체 JS 코드를
  하나의 코드블록으로 제공합니다.

- CSS 파일을 요청하면 전체 CSS를 하나의 코드블록으로 제공합니다.

- JSON/CSV/MD/TXT 파일을 요청하면 실제 저장 가능한
  완성된 내용을 코드블록으로 제공합니다.

- 파일을 생성해 달라는 요청에서는 파일 내용과 답변 내용이
  서로 섞이지 않도록 명확하게 구분하세요.

- 첨부파일의 내용과 관련된 후속 질문에서는
  이전에 첨부된 자료를 계속 참조하세요.

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


/*
 * Markdown 코드블록 추출
 *
 * 예:
 * ```html
 * <!DOCTYPE html>
 * ...
 * ```
 */
function extractCodeBlocks(text) {
  const out = [];

  const re =
    /```([^\s\n]*)\s*\n([\s\S]*?)```/g;

  let m;

  while ((m = re.exec(String(text || "")))) {
    out.push({
      lang: (
        m[1] ||
        "text"
      ).toLowerCase(),

      code: m[2]
    });
  }

  /*
   * 코드펜스가 없어도 완전한 HTML이면 추출
   */
  if (!out.length) {
    const raw = String(text || "");

    const start =
      raw.search(/<!doctype\s+html/i);

    const end =
      raw.toLowerCase()
        .lastIndexOf("</html>");

    if (
      start >= 0 &&
      end > start
    ) {
      out.push({
        lang: "html",
        code: raw.slice(
          start,
          end + 7
        )
      });
    }
  }

  return out;
}


/*
 * 사용자가 어떤 파일을 원하는지 판별
 */
function requestedFileType(question) {
  const q =
    String(question || "")
      .toLowerCase();

  if (
    /(이미지|그림|사진|png|jpg|jpeg)/.test(q)
  ) {
    return "image";
  }

  if (
    /(pdf|피디에프)/.test(q)
  ) {
    return "pdf";
  }

  if (
    /(html|htm|웹페이지|웹 페이지)/.test(q)
  ) {
    return "html";
  }

  if (
    /(javascript|자바스크립트|js 파일)/.test(q)
  ) {
    return "js";
  }

  if (
    /(css 파일|스타일시트)/.test(q)
  ) {
    return "css";
  }

  if (
    /(json 파일)/.test(q)
  ) {
    return "json";
  }

  if (
    /(csv 파일)/.test(q)
  ) {
    return "csv";
  }

  if (
    /(마크다운|markdown|md 파일)/.test(q)
  ) {
    return "md";
  }

  if (
    /(텍스트 파일|txt 파일)/.test(q)
  ) {
    return "txt";
  }

  return null;
}


/*
 * 답변에서 해당 파일에 사용할 코드 추출
 */
function fileFromAnswer(
  answer,
  type
) {
  const blocks =
    extractCodeBlocks(answer);

  const aliases = {
    html: [
      "html",
      "htm"
    ],

    js: [
      "js",
      "javascript",
      "typescript",
      "ts"
    ],

    css: [
      "css"
    ],

    json: [
      "json"
    ],

    csv: [
      "csv"
    ],

    md: [
      "md",
      "markdown"
    ],

    txt: [
      "text",
      "txt"
    ]
  };

  const match =
    aliases[type] || [type];

  const selected =
    blocks.find(
      x => match.includes(x.lang)
    ) ||
    blocks[0];

  const content =
    selected
      ? selected.code
      : String(answer || "");

  const info = {
    html: [
      "index.html",
      "text/html;charset=utf-8",
      "🌐"
    ],

    js: [
      "script.js",
      "text/javascript;charset=utf-8",
      "🟨"
    ],

    css: [
      "style.css",
      "text/css;charset=utf-8",
      "🎨"
    ],

    json: [
      "data.json",
      "application/json;charset=utf-8",
      "🧩"
    ],

    csv: [
      "data.csv",
      "text/csv;charset=utf-8",
      "📊"
    ],

    md: [
      "document.md",
      "text/markdown;charset=utf-8",
      "📝"
    ],

    txt: [
      "document.txt",
      "text/plain;charset=utf-8",
      "📄"
    ]
  }[type];

  return {
    name: info[0],
    type: info[1],
    content,
    icon: info[2]
  };
}


/*
 * Buffer → Data URL
 */
function toDataUrl(
  buffer,
  mime
) {
  return (
    `data:${mime};base64,` +
    buffer.toString("base64")
  );
}


/*
 * 간단한 PDF 생성기
 *
 * 주의:
 * 기본 Helvetica를 사용하므로
 * 한글은 완전한 한글 PDF용으로는 적합하지 않습니다.
 */
function makeSimplePdf(text) {

  const lines =
    String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .slice(0, 250)
      .map(line =>
        line
          .replace(
            /[^\x20-\x7E]/g,
            "?"
          )
          .slice(0, 95)
      );

  const perPage = 50;

  const pages = [];

  for (
    let i = 0;
    i < lines.length;
    i += perPage
  ) {
    pages.push(
      lines.slice(
        i,
        i + perPage
      )
    );
  }

  if (!pages.length) {
    pages.push([""]);
  }

  const escapePdf =
    s =>
      s
        .replace(
          /\\/g,
          "\\\\"
        )
        .replace(
          /\(/g,
          "\\("
        )
        .replace(
          /\)/g,
          "\\)"
        );

  const objects = [];

  const addObject =
    body => {
      objects.push(body);
      return objects.length;
    };

  const catalog =
    addObject("");

  const pagesObject =
    addObject("");

  const font =
    addObject(
      "<< /Type /Font " +
      "/Subtype /Type1 " +
      "/BaseFont /Helvetica >>"
    );

  const pageRefs = [];

  for (
    const pageLines of pages
  ) {

    let stream =
      "BT\n" +
      "/F1 10 Tf\n";

    let y = 750;

    for (
      const line of pageLines
    ) {

      stream +=
        `1 0 0 1 45 ${y} Tm ` +
        `(${escapePdf(line)}) Tj\n`;

      y -= 14;
    }

    stream += "ET";

    const streamObject =
      addObject(
        `<< /Length ` +
        `${Buffer.byteLength(
          stream,
          "latin1"
        )} >>\n` +
        `stream\n` +
        `${stream}\n` +
        `endstream`
      );

    const pageObject =
      addObject(
        `<< /Type /Page ` +
        `/Parent ${pagesObject} 0 R ` +
        `/MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ` +
        `${font} 0 R >> >> ` +
        `/Contents ${streamObject} 0 R >>`
      );

    pageRefs.push(
      pageObject
    );
  }

  objects[catalog - 1] =
    `<< /Type /Catalog ` +
    `/Pages ${pagesObject} 0 R >>`;

  objects[pagesObject - 1] =
    `<< /Type /Pages ` +
    `/Kids [` +
    pageRefs
      .map(
        x => `${x} 0 R`
      )
      .join(" ") +
    `] ` +
    `/Count ${pageRefs.length} >>`;

  let pdf =
    "%PDF-1.4\n";

  const offsets = [0];

  objects.forEach(
    (obj, i) => {

      offsets[i + 1] =
        Buffer.byteLength(
          pdf,
          "latin1"
        );

      pdf +=
        `${i + 1} 0 obj\n` +
        `${obj}\n` +
        `endobj\n`;
    }
  );

  const xref =
    Buffer.byteLength(
      pdf,
      "latin1"
    );

  pdf +=
    `xref\n` +
    `0 ${objects.length + 1}\n`;

  pdf +=
    "0000000000 65535 f \n";

  for (
    let i = 1;
    i <= objects.length;
    i++
  ) {

    pdf +=
      `${String(
        offsets[i]
      ).padStart(
        10,
        "0"
      )} 00000 n \n`;
  }

  pdf +=
    `trailer\n` +
    `<< /Size ` +
    `${objects.length + 1} ` +
    `/Root ${catalog} 0 R >>\n`;

  pdf +=
    `startxref\n` +
    `${xref}\n` +
    `%%EOF`;

  return Buffer.from(
    pdf,
    "latin1"
  );
}


/*
 * 이미지 생성
 *
 * gpt-image-1 사용
 */
async function createImageFile(
  prompt
) {

  const result =
    await client.images.generate({
      model: "gpt-image-1",
      prompt: String(
        prompt ||
        "Create the requested image."
      ),
      size: "1024x1024"
    });

  const item =
    result.data?.[0];

  if (!item) {
    throw new Error(
      "이미지 생성 결과가 없습니다."
    );
  }

  /*
   * Base64 결과
   */
  if (item.b64_json) {

    return {
      name:
        "generated-image.png",

      type:
        "image/png",

      dataUrl:
        `data:image/png;base64,` +
        item.b64_json,

      icon:
        "🖼️"
    };
  }

  /*
   * URL 결과
   */
  if (item.url) {

    return {
      name:
        "generated-image.png",

      type:
        "image/png",

      url:
        item.url,

      icon:
        "🖼️"
    };
  }

  throw new Error(
    "이미지 데이터를 받을 수 없습니다."
  );
}


/*
 * API Handler
 */
export default async function handler(
  req,
  res
) {

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({
        error: "POST only"
      });
  }

  if (
    !process.env.OPENAI_API_KEY
  ) {
    return res
      .status(500)
      .json({
        error:
          "OPENAI_API_KEY 환경변수가 없습니다."
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


    /*
     * 현재 사용자 질문
     */
    const current = {
      role: "user",

      content:
        question ||
        "첨부한 자료를 분석해 주세요.",

      images,

      files
    };


    /*
     * 전체 입력
     */
    const input = [

      {
        role: "developer",

        content: [
          {
            type: "input_text",

            text:
              buildInstructions()
          }
        ]
      },

      ...normalizeHistory(
        history
      ),

      {
        role: "user",

        content:
          buildUserContent(
            current
          )
      }

    ];


    /*
     * Vector Store
     *
     * 기존 방식 그대로 유지
     */
    const vectorStoreId =
      await getVectorStoreId();


    /*
     * 기존 Web Search + File Search 유지
     */
    const tools = [

      {
        type: "web_search"
      },

      {
        type: "file_search",

        vector_store_ids:
          [vectorStoreId],

        max_num_results:
          8
      }

    ];


    /*
     * OpenAI Responses API
     */
    const response =
      await client.responses.create({

        model:
          model ||
          "gpt-5.6",

        input,

        tools

      });


    /*
     * 답변
     */
    const answer =
      response.output_text ||
      "응답이 없습니다.";


    /*
     * 생성 파일 배열
     *
     * 기존 index.html의
     * files[] 처리와 연결됩니다.
     */
    const generatedFiles = [];


    /*
     * 사용자가 요청한 파일 종류 확인
     */
    const fileType =
      requestedFileType(
        question
      );


    /*
     * 이미지 생성
     */
    if (
      fileType === "image"
    ) {

      const image =
        await createImageFile(
          question
        );

      generatedFiles.push(
        image
      );
    }


    /*
     * PDF 생성
     */
    else if (
      fileType === "pdf"
    ) {

      const pdf =
        makeSimplePdf(
          answer
        );

      generatedFiles.push({

        name:
          "document.pdf",

        type:
          "application/pdf",

        dataUrl:
          toDataUrl(
            pdf,
            "application/pdf"
          ),

        icon:
          "📕"

      });
    }


    /*
     * HTML / CSS / JS /
     * JSON / CSV / MD / TXT
     */
    else if (
      fileType
    ) {

      generatedFiles.push(
        fileFromAnswer(
          answer,
          fileType
        )
      );
    }


    /*
     * index.html로 전달
     */
    return res
      .status(200)
      .json({

        answer,

        files:
          generatedFiles,

        /*
         * 기존 Vector Store ID도
         * 그대로 반환
         */
        vector_store_id:
          vectorStoreId

      });

  }

  catch (e) {

    console.error(e);

    return res
      .status(500)
      .json({

        error:
          e?.message ||
          "OpenAI API 오류"

      });
  }
      }
