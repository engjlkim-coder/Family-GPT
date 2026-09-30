import { client, getVectorStoreId } from "./_vectorStore.js";

/*
 * Family GPT 3.5 Final
 *
 * 기존 기능 유지
 * - Vector Store 자동 생성/사용
 * - web_search
 * - file_search
 * - 이미지 첨부
 * - 코드/텍스트 파일 첨부
 * - 후속 질문
 *
 * 추가 기능
 * - "파일로 만들어줘" 자동 인식
 * - "다운로드할 파일로 만들어줘" 자동 인식
 * - HTML / JS / CSS / JSON / CSV / MD / TXT 파일 생성
 * - PDF 생성
 * - 이미지 생성
 * - files[] 응답
 */


/* =========================================================
   기본 입력 처리
   ========================================================= */

function buildUserContent(message) {

  const parts = [];

  if (message?.content) {

    parts.push({
      type: "input_text",
      text: String(message.content)
    });

  }

  /*
   * 이미지 첨부
   */
  for (
    const src of (
      Array.isArray(message?.images)
        ? message.images
        : []
    ).slice(0, 4)
  ) {

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


  /*
   * 코드 / 텍스트 파일 첨부
   */
  for (
    const file of (
      Array.isArray(message?.files)
        ? message.files
        : []
    ).slice(0, 6)
  ) {

    if (
      file &&
      typeof file.content === "string"
    ) {

      const name =
        String(
          file.name ||
          "첨부파일"
        );

      parts.push({
        type: "input_text",

        text:
          "\n===== 첨부 파일 시작 =====\n" +
          `파일명: ${name}\n` +
          "\n" +
          file.content +
          "\n" +
          "===== 첨부 파일 끝 =====\n"
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


/* =========================================================
   대화 이력
   ========================================================= */

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

        return {
          role: "assistant",

          content: [
            {
              type: "output_text",

              text:
                String(
                  x.content || ""
                )
            }
          ]
        };

      }

      return {

        role: "user",

        content:
          buildUserContent(x)

      };

    });
}


/* =========================================================
   시스템 지침
   ========================================================= */

function buildInstructions() {

  return `
당신은 개인용 AI 비서입니다.

[도구 선택]

필요한 경우에만 도구를 사용하세요.

1. 최신성/현재성이 중요한 질문은 web_search를 사용하세요.

예:
- 현재 날씨
- 오늘/최근 뉴스
- 현재 주가/환율/가격
- 최신 제품 정보
- 최신 정책/기술 정보
- "지금", "오늘", "최신", "현재" 등이 포함된 질문


2. 등록된 가족/개인 지식자료에서 답을 찾아야 하는 질문은
file_search를 사용하세요.


3. 일반적인 지식이나 사용자가 직접 첨부한 자료를 분석하는 질문은
불필요한 웹검색을 하지 마세요.


4. 한 질문에서 최신 웹정보와 등록 지식자료가 모두 필요하면
두 도구를 함께 사용할 수 있습니다.


[첨부파일]

이미지가 첨부되면 이미지 자체를 분석하세요.

HTML/CSS/JavaScript/JSON/XML/SVG/TXT/MD/CSV 등의
코드·텍스트 파일이 첨부되면 실제 파일 내용을 기준으로
구조와 오류를 분석하세요.

사용자가 수정해 달라고 하면 원인을 파악한 뒤
수정 코드를 제시하세요.


[코드 작성]

사용자가 코드를 요청하면 가능한 한 완전한 실행 가능한
코드를 제공하세요.

HTML이면 <!DOCTYPE html>부터 완전한 HTML 문서를 제공합니다.

JavaScript 파일이면 실행 가능한 전체 JS 파일을 제공합니다.

CSS 파일이면 전체 CSS를 제공합니다.

기존 파일을 수정하는 경우에는 수정된 전체 파일을
제공하는 것을 우선합니다.


[파일 생성]

사용자가 다음과 같이 요청하면 실제 다운로드 가능한
파일로 만들 수 있도록 답변 내용을 코드블록으로 제공합니다.

- "파일로 만들어줘"
- "파일로 만들어 주세요"
- "다운로드할 파일로 만들어줘"
- "다운로드할 수 있게 만들어줘"
- "파일로 저장해줘"
- "저장할 수 있는 파일로 만들어줘"
- "파일로 만들어서 다운로드하게 해줘"
- "이 코드를 파일로 만들어줘"


HTML:
완전한 HTML 문서를 코드블록으로 제공합니다.

JavaScript:
완전한 JS 코드를 코드블록으로 제공합니다.

CSS:
완전한 CSS 코드를 코드블록으로 제공합니다.

JSON:
유효한 JSON만 코드블록으로 제공합니다.

CSV:
저장 가능한 CSV 내용을 코드블록으로 제공합니다.

Markdown:
Markdown 문서 전체를 코드블록으로 제공합니다.

TXT:
저장 가능한 텍스트 전체를 코드블록으로 제공합니다.


PDF:
사용자가 PDF를 요청하면 PDF로 만들 내용을 완성된 형태로 제공합니다.


이미지:
사용자가 이미지/그림/사진/PNG/JPG 파일을 요청하면
이미지 생성 기능을 사용할 수 있습니다.


[대화]

이전 대화의 맥락을 유지하세요.

사용자가 이전에 첨부한 파일을 후속 질문에서 다시 언급하면
가능한 경우 해당 내용을 계속 참조하세요.

파일에 없는 내용을 파일에서 확인했다고 말하지 마세요.
`;
}


/* =========================================================
   코드블록 추출
   ========================================================= */

function extractCodeBlocks(text) {

  const out = [];

  const re =
    /```([^\s\n]*)\s*\n([\s\S]*?)```/g;

  let m;

  while (
    (m = re.exec(
      String(text || "")
    ))
  ) {

    out.push({

      lang:
        (
          m[1] ||
          "text"
        ).toLowerCase(),

      code:
        m[2]

    });

  }


  /*
   * 코드펜스가 없어도 HTML이면 자동 인식
   */
  if (!out.length) {

    const raw =
      String(text || "");

    const start =
      raw.search(
        /<!doctype\s+html/i
      );

    const end =
      raw.toLowerCase()
        .lastIndexOf("</html>");

    if (
      start >= 0 &&
      end > start
    ) {

      out.push({

        lang: "html",

        code:
          raw.slice(
            start,
            end + 7
          )

      });

    }

  }


  return out;
}


/* =========================================================
   파일 요청 여부 판별
   ========================================================= */

function isGenericFileRequest(question) {

  const q =
    String(question || "")
      .toLowerCase();

  return (
    /(파일로\s*만들어|파일로\s*만들어줘|파일로\s*만들어주세요)/.test(q) ||
    /(파일로\s*저장|파일로\s*저장해줘|파일로\s*저장해주세요)/.test(q) ||
    /(다운로드할\s*파일|다운로드\s*가능한\s*파일)/.test(q) ||
    /(다운로드할\s*수\s*있게|다운로드\s*가능하게)/.test(q) ||
    /(파일로\s*다운로드)/.test(q) ||
    /(파일을\s*만들어)/.test(q) ||
    /(저장할\s*파일로)/.test(q)
  );
}


/* =========================================================
   명시적 파일 종류 판별
   ========================================================= */

function requestedFileType(question) {

  const q =
    String(question || "")
      .toLowerCase();


  /*
   * 이미지
   */
  if (
    /(이미지|그림|사진|png|jpg|jpeg|webp)/.test(q)
  ) {

    return "image";

  }


  /*
   * PDF
   */
  if (
    /(pdf|피디에프)/.test(q)
  ) {

    return "pdf";

  }


  /*
   * HTML
   */
  if (
    /(html|htm|웹페이지|웹 페이지|홈페이지)/.test(q)
  ) {

    return "html";

  }


  /*
   * JavaScript
   */
  if (
    /(javascript|자바스크립트|js 파일|js파일)/.test(q)
  ) {

    return "js";

  }


  /*
   * CSS
   */
  if (
    /(css 파일|css파일|스타일시트)/.test(q)
  ) {

    return "css";

  }


  /*
   * JSON
   */
  if (
    /(json 파일|json파일)/.test(q)
  ) {

    return "json";

  }


  /*
   * CSV
   */
  if (
    /(csv 파일|csv파일)/.test(q)
  ) {

    return "csv";

  }


  /*
   * Markdown
   */
  if (
    /(마크다운|markdown|md 파일|md파일)/.test(q)
  ) {

    return "md";

  }


  /*
   * TXT
   */
  if (
    /(텍스트 파일|txt 파일|txt파일)/.test(q)
  ) {

    return "txt";

  }


  /*
   * 명시적인 종류가 없더라도
   * "파일로 만들어줘"가 있으면
   * 코드블록을 보고 자동 판단할 수 있도록
   * generic-file을 반환
   */
  if (
    isGenericFileRequest(q)
  ) {

    return "auto";

  }


  return null;
}


/* =========================================================
   코드 언어 자동 판별
   ========================================================= */

function detectCodeType(
  answer
) {

  const blocks =
    extractCodeBlocks(
      answer
    );


  if (!blocks.length) {
    return "txt";
  }


  const first =
    blocks[0];


  const lang =
    String(
      first.lang || ""
    ).toLowerCase();


  /*
   * Markdown 언어명
   */
  if (
    [
      "html",
      "htm"
    ].includes(lang)
  ) {

    return "html";

  }


  if (
    [
      "js",
      "javascript",
      "typescript",
      "ts"
    ].includes(lang)
  ) {

    return "js";

  }


  if (
    lang === "css"
  ) {

    return "css";

  }


  if (
    lang === "json"
  ) {

    return "json";

  }


  if (
    lang === "csv"
  ) {

    return "csv";

  }


  if (
    [
      "md",
      "markdown"
    ].includes(lang)
  ) {

    return "md";

  }


  if (
    [
      "txt",
      "text"
    ].includes(lang)
  ) {

    return "txt";

  }


  /*
   * 언어 표시가 없을 경우 내용으로 판단
   */

  const code =
    String(
      first.code || ""
    );


  /*
   * HTML
   */
  if (
    /<!doctype\s+html/i.test(code) ||
    /<html[\s>]/i.test(code)
  ) {

    return "html";

  }


  /*
   * JSON
   */
  try {

    const parsed =
      JSON.parse(code);

    if (
      parsed !== null &&
      (
        typeof parsed === "object" ||
        Array.isArray(parsed)
      )
    ) {

      return "json";

    }

  } catch {}


  /*
   * CSS
   */
  if (
    /[.#a-zA-Z][^{]*\{[\s\S]*:[^;]+;[\s\S]*\}/.test(
      code
    )
  ) {

    if (
      !/(function|const|let|var|document\.|=>)/.test(
        code
      )
    ) {

      return "css";

    }

  }


  /*
   * JavaScript
   */
  if (
    /\b(const|let|var|function|class)\b/.test(code) ||
    /document\./.test(code) ||
    /addEventListener\s*\(/.test(code) ||
    /=>/.test(code)
  ) {

    return "js";

  }


  return "txt";
}


/* =========================================================
   파일 생성
   ========================================================= */

function fileFromAnswer(
  answer,
  type
) {

  const blocks =
    extractCodeBlocks(
      answer
    );


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
    aliases[type] ||
    [type];


  const selected =
    blocks.find(
      x =>
        match.includes(
          x.lang
        )
    ) ||
    blocks[0];


  /*
   * 코드블록이 있으면 코드만 저장
   */
  let content =
    selected
      ? selected.code
      : String(answer || "");


  /*
   * 자동 생성된 txt가 아닌 경우
   * 답변 앞뒤의 설명을 제거하고
   * 가능한 경우 코드만 저장
   */
  if (
    type !== "txt" &&
    !selected
  ) {

    content =
      String(answer || "")
        .trim();

  }


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

    name:
      info[0],

    type:
      info[1],

    content,

    icon:
      info[2]

  };
}


/* =========================================================
   PDF 생성
   ========================================================= */

function makeSimplePdf(
  text
) {

  const lines =
    String(text || "")
      .replace(
        /\r/g,
        ""
      )
      .split("\n")
      .slice(0, 250)
      .map(
        line =>
          line
            .replace(
              /[^\x20-\x7E]/g,
              "?"
            )
            .slice(0, 95)
      );


  const perPage =
    50;

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

    pages.push([
      ""
    ]);

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

      objects.push(
        body
      );

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

    let y =
      750;


    for (
      const line of pageLines
    ) {

      stream +=
        `1 0 0 1 45 ${y} Tm ` +
        `(${escapePdf(line)}) Tj\n`;

      y -= 14;

    }


    stream +=
      "ET";


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


  objects[
    catalog - 1
  ] =
    `<< /Type /Catalog ` +
    `/Pages ${pagesObject} 0 R >>`;


  objects[
    pagesObject - 1
  ] =
    `<< /Type /Pages ` +
    `/Kids [` +
    pageRefs
      .map(
        x =>
          `${x} 0 R`
      )
      .join(" ") +
    `] ` +
    `/Count ${pageRefs.length} >>`;


  let pdf =
    "%PDF-1.4\n";


  const offsets =
    [0];


  objects.forEach(
    (obj, i) => {

      offsets[
        i + 1
      ] =
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


/* =========================================================
   Data URL
   ========================================================= */

function toDataUrl(
  buffer,
  mime
) {

  return (
    `data:${mime};base64,` +
    buffer.toString(
      "base64"
    )
  );

}


/* =========================================================
   이미지 생성
   ========================================================= */

async function createImageFile(
  prompt
) {

  const result =
    await client.images.generate({

      model:
        "gpt-image-1",

      prompt:
        String(
          prompt ||
          "Create the requested image."
        ),

      size:
        "1024x1024"

    });


  const item =
    result.data?.[0];


  if (!item) {

    throw new Error(
      "이미지 생성 결과가 없습니다."
    );

  }


  /*
   * Base64
   */
  if (
    item.b64_json
  ) {

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
   * URL
   */
  if (
    item.url
  ) {

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


/* =========================================================
   API Handler
   ========================================================= */

export default async function handler(
  req,
  res
) {

  /*
   * POST만 허용
   */
  if (
    req.method !== "POST"
  ) {

    return res
      .status(405)
      .json({
        error:
          "POST only"
      });

  }


  /*
   * API Key 확인
   */
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
    } =
      req.body || {};


    /*
     * 현재 사용자 질문
     */
    const current = {

      role:
        "user",

      content:
        question ||
        "첨부한 자료를 분석해 주세요.",

      images,

      files

    };


    /*
     * Responses API 입력
     */
    const input = [

      {
        role:
          "developer",

        content: [

          {
            type:
              "input_text",

            text:
              buildInstructions()

          }

        ]

      },

      ...normalizeHistory(
        history
      ),

      {

        role:
          "user",

        content:
          buildUserContent(
            current
          )

      }

    ];


    /*
     * Vector Store
     *
     * 기존 _vectorStore.js 구조 유지
     */
    const vectorStoreId =
      await getVectorStoreId();


    /*
     * 기존 검색 도구 유지
     */
    const tools = [

      {
        type:
          "web_search"
      },

      {
        type:
          "file_search",

        vector_store_ids:
          [
            vectorStoreId
          ],

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
     * AI 답변
     */
    const answer =
      response.output_text ||
      "응답이 없습니다.";


    /*
     * 생성 파일
     */
    const generatedFiles =
      [];


    /*
     * 파일 종류 판별
     */
    let fileType =
      requestedFileType(
        question
      );


    /*
     * =====================================================
     * "파일로 만들어줘"처럼 확장자가 없는 경우
     * AI 답변의 코드블록을 분석하여 자동 결정
     * =====================================================
     */
    if (
      fileType === "auto"
    ) {

      fileType =
        detectCodeType(
          answer
        );

    }


    /*
     * =====================================================
     * 이미지
     * =====================================================
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
     * =====================================================
     * PDF
     * =====================================================
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
     * =====================================================
     * HTML / JS / CSS / JSON / CSV / MD / TXT
     * =====================================================
     */
    else if (

      [
        "html",
        "js",
        "css",
        "json",
        "csv",
        "md",
        "txt"
      ].includes(
        fileType
      )

    ) {

      generatedFiles.push(

        fileFromAnswer(
          answer,
          fileType
        )

      );

    }


    /*
     * =====================================================
     * 최종 응답
     * =====================================================
     */
    return res
      .status(200)
      .json({

        answer,

        files:
          generatedFiles,

        vector_store_id:
          vectorStoreId

      });


  }

  catch (e) {

    console.error(
      "api/chat error:",
      e
    );


    return res
      .status(500)
      .json({

        error:
          e?.message ||
          "OpenAI API 오류"

      });

  }

}
