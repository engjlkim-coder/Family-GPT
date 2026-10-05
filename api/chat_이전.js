import { toFile } from "openai";
import { client, getVectorStoreId } from "./_vectorStore.js";

/*
 * Family GPT 3.6 (PDF 안정화 버전)
 *
 * 변경 사항
 * 1. PDF: 모델 답변에서 HTML 코드블록만 추출 (설명문/코드펜스가 PDF에 섞이지 않음)
 * 2. PDF: Chromium에는 한글 폰트가 없으므로 Noto Sans KR 웹폰트를 주입하고
 *         폰트 로딩이 끝날 때까지 기다린 뒤 PDF 생성 (글자 깨짐 방지)
 * 3. PDF: 최신 @sparticuz/chromium 사용법 적용 (headless: "shell", defaultViewport 제거)
 * 4. PDF: 생성 실패 시 500 오류로 끝내지 않고 HTML 파일로 대체 제공
 * 5. 파일 요청 판별을 "파일 생성 의도"가 있을 때만 동작하도록 개선
 *    (예: "이 사진 분석해줘"가 이미지 생성으로 오인되지 않음)
 * 6. PDF 요청은 이미지 판별보다 먼저 검사
 * 7. PDF 성공 시 채팅창에는 짧은 안내만 표시 (긴 HTML 코드 노출 방지)
 */

/* =========================================================
   설정
   ========================================================= */

const MAX_PDF_BYTES = 3 * 1024 * 1024; // Vercel 응답 한도(약 4.5MB) 보호용
const PAGE_TIMEOUT_MS = 25000;
const MAX_ATTACH_CHARS = 300000; // 첨부 텍스트 1개당 모델에 보낼 최대 글자 수


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

  /* 이미지 첨부 */
  const images = Array.isArray(message?.images) ? message.images : [];

  for (const src of images.slice(0, 4)) {
    if (typeof src === "string" && src.startsWith("data:image/")) {
      parts.push({
        type: "input_image",
        image_url: src,
        detail: "high"
      });
    }
  }

  /* 코드 / 텍스트 파일 첨부 */
  const files = Array.isArray(message?.files) ? message.files : [];

  for (const file of files.slice(0, 6)) {

    /* PDF: 모델이 직접 읽도록 input_file로 전달 */
    if (
      file &&
      typeof file.pdf === "string" &&
      file.pdf.startsWith("data:application/pdf")
    ) {
      parts.push({
        type: "input_file",
        filename: String(file.name || "document.pdf"),
        file_data: file.pdf
      });
      continue;
    }

    if (file && typeof file.content === "string") {

      const name = String(file.name || "첨부파일");

      parts.push({
        type: "input_text",
        text:
          "\n===== 첨부 파일 시작 =====\n" +
          `파일명: ${name}\n\n` +
          (file.content.length > MAX_ATTACH_CHARS
            ? file.content.slice(0, MAX_ATTACH_CHARS) +
              "\n\n[... 파일이 길어 앞부분만 전달되었습니다 ...]"
            : file.content) +
          "\n===== 첨부 파일 끝 =====\n"
      });
    }
  }

  return parts.length
    ? parts
    : [{ type: "input_text", text: "" }];
}


/* =========================================================
   대화 이력
   (assistant 메시지의 files(base64)는 사용하지 않음)
   ========================================================= */

/* 모델에 보낼 이전 메시지 개수 */
const MAX_HISTORY = 8;

/* 첨부 원본을 유지할 사용자 턴 수 (직전 질문부터 센다)
 * - 사진/PDF  : 용량이 커서 짧게 유지
 * - 코드/텍스트: 수정 작업 때문에 길게 유지 */
const KEEP_IMAGE_TURNS = 1;
const KEEP_TEXT_TURNS = 3;

/* 원본 대신 넣을 짧은 안내 문구 */
function attachNote(names, imgCount) {

  const parts = [];

  if (names.length) parts.push("파일: " + names.join(", "));
  if (imgCount) parts.push("이미지 " + imgCount + "장");

  return parts.length
    ? `\n[이전 질문 첨부 - ${parts.join(" / ")} (내용은 생략됨)]`
    : "";
}

/* 파일에 실제 내용(텍스트/PDF)이 있는지 */
function hasBody(f) {
  return !!f && (typeof f.content === "string" || typeof f.pdf === "string");
}

function normalizeHistory(history) {

  if (!Array.isArray(history)) {
    return [];
  }

  const list = history
    .slice(-MAX_HISTORY)
    .filter(x => x && (x.role === "user" || x.role === "assistant"));

  return list.map((x, i) => {

    if (x.role === "assistant") {
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

    /* 이 메시지가 뒤에서 몇 번째 사용자 질문인지 (0 = 직전) */
    const rank = list
      .slice(i + 1)
      .filter(y => y.role === "user").length;

    const keepImg = rank < KEEP_IMAGE_TURNS;
    const keepTxt = rank < KEEP_TEXT_TURNS;

    const files = Array.isArray(x.files) ? x.files : [];
    const images = Array.isArray(x.images) ? x.images : [];

    const isKept = f => hasBody(f) && (f.pdf ? keepImg : keepTxt);

    const keptFiles = files.filter(isKept);
    const droppedNames = files
      .filter(f => f && !isKept(f))
      .map(f => f.name)
      .filter(Boolean);

    const droppedImgCount = keepImg
      ? 0
      : (Number(x.imageCount) || images.length);

    return {
      role: "user",
      content: buildUserContent({
        content:
          String(x.content || "") +
          attachNote(droppedNames, droppedImgCount),
        images: keepImg ? images : [],
        files: keptFiles
      })
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

PDF는 원본 파일로, Word(.docx)와 Excel(.xlsx)은 텍스트로 변환되어
첨부됩니다. Excel은 시트별 CSV 형태이며 행이 많으면 앞부분만
전달될 수 있으니, 일부만 보았다면 그 사실을 밝히세요.

사용자가 수정해 달라고 하면 원인을 파악한 뒤
수정 코드를 제시하세요.


[코드 작성]

사용자가 코드를 요청하면 가능한 한 완전한 실행 가능한
코드를 제공하세요.

HTML이면 <!DOCTYPE html>부터 완전한 HTML 문서를 제공합니다.
JavaScript 파일이면 실행 가능한 전체 JS 파일을 제공합니다.
CSS 파일이면 전체 CSS를 제공합니다.
기존 파일을 수정하는 경우에는 수정된 전체 파일을 제공하는 것을 우선합니다.


[파일 생성]

사용자가 "파일로 만들어줘", "다운로드할 수 있게 만들어줘",
"파일로 저장해줘" 등으로 요청하면 실제 다운로드 가능한 파일로
만들 수 있도록 답변 내용을 코드블록으로 제공합니다.

HTML: 완전한 HTML 문서를 코드블록으로 제공합니다.
JavaScript: 완전한 JS 코드를 코드블록으로 제공합니다.
CSS: 완전한 CSS 코드를 코드블록으로 제공합니다.
JSON: 유효한 JSON만 코드블록으로 제공합니다.
CSV: 저장 가능한 CSV 내용을 코드블록으로 제공합니다.
Markdown: Markdown 문서 전체를 코드블록으로 제공합니다.
TXT: 저장 가능한 텍스트 전체를 코드블록으로 제공합니다.

이미지: 사용자가 이미지/그림/사진을 만들어 달라고 하면
이미지 생성 기능을 사용할 수 있습니다.


[데이터 분석 대시보드]

JSON/CSV/Excel 데이터를 분석해 대시보드(HTML)를 만들 때:
- 합계·평균·비율 같은 숫자는 직접 계산해서 적지 말고,
  HTML 안의 JavaScript가 데이터로부터 계산하도록 작성하세요.
- 차트는 Chart.js(https://cdn.jsdelivr.net/npm/chart.js@4)를 사용하세요.
- 데이터가 작으면(약 200행 이하) 데이터를 HTML 안에 포함하세요.
  데이터가 크면 일부만 넣지 말고, JSON 파일을 선택해서 불러오는
  <input type="file"> 버튼을 만들어 브라우저에서 읽게 하세요.
- 반응형(모바일 포함) 레이아웃으로, 완전한 HTML 문서 하나를
  코드블록으로 제공하세요.


[대화]

이전 대화의 맥락을 유지하세요.

사용자가 이전에 첨부한 파일을 후속 질문에서 다시 언급하면
가능한 경우 해당 내용을 계속 참조하세요.

파일에 없는 내용을 파일에서 확인했다고 말하지 마세요.
`;
}


/* PDF 요청일 때만 추가로 붙이는 지침 */
function buildPdfInstructions() {

  return `
[이번 요청은 PDF 문서 생성입니다]

반드시 아래 규칙을 지키세요.

1. 응답 전체를 \`\`\`html 코드블록 하나로만 작성하세요.
   코드블록 앞뒤에 설명, 인사, 안내문을 쓰지 마세요.

2. <!DOCTYPE html>부터 </html>까지 완전한 HTML 문서로 작성하세요.
   <meta charset="UTF-8">을 포함하세요.

3. "PDF로 만들어 드리겠습니다" 같은 안내 문구를 문서 안에 넣지 마세요.
   사용자가 요청한 결과물 자체를 문서로 작성하세요.

4. JavaScript(<script>)와 외부 이미지는 사용하지 마세요.
   표, 목록, 제목, 강조 등은 HTML/CSS만으로 구성하세요.

5. A4 인쇄 기준 CSS를 사용하세요. (@page { size: A4; margin: 15mm; })
   글꼴은 'Noto Sans KR'을 사용하세요.
`;
}


/* =========================================================
   코드블록 추출
   ========================================================= */

function extractCodeBlocks(text) {

  const out = [];
  const src = String(text || "");

  const re = /```([^\s\n]*)\s*\n([\s\S]*?)```/g;

  let m;

  while ((m = re.exec(src))) {
    out.push({
      lang: (m[1] || "text").toLowerCase(),
      code: m[2]
    });
  }

  /* 코드펜스가 없어도 HTML이면 자동 인식 */
  if (!out.length) {

    const start = src.search(/<!doctype\s+html/i);
    const end = src.toLowerCase().lastIndexOf("</html>");

    if (start >= 0 && end > start) {
      out.push({
        lang: "html",
        code: src.slice(start, end + 7)
      });
    }
  }

  return out;
}


/* =========================================================
   요청 의도 판별
   ========================================================= */

/* "만들어줘 / 저장 / 다운로드 / 파일" 같은 파일 생성 의도 */
function hasFileIntent(q) {
  return /(파일|다운로드|다운 받|저장|만들어|만들어줘|만들어주세요|생성|변환|뽑아|출력|내보내)/.test(q);
}

/* "파일로 만들어줘" 계열 (종류 미지정) */
function isGenericFileRequest(q) {
  return (
    /파일로\s*(만들|저장|다운로드)/.test(q) ||
    /(다운로드할|다운로드\s*가능한|저장할)\s*(수\s*있는\s*)?파일/.test(q) ||
    /(다운로드할\s*수\s*있게|다운로드\s*가능하게)/.test(q) ||
    /파일을\s*만들/.test(q)
  );
}

/* 이미지를 "만들어 달라"는 의도인지 */
function isImageCreateRequest(q) {

  const hasNoun = /(이미지|그림|사진|일러스트|png|jpg|jpeg|webp|캐릭터|만화|애니)/.test(q);
  const hasVerb = /(만들|생성|그려|그리|제작|뽑아|변환|바꿔|바꾸|스타일|풍으로|느낌으로)/.test(q);

  return hasNoun && hasVerb;
}

function requestedFileType(question) {

  const q = String(question || "").toLowerCase();

  /* 1) PDF: 이미지보다 먼저 검사 */
  if (/(pdf|피디에프)/.test(q) && hasFileIntent(q)) {
    return "pdf";
  }

  /* 2) 이미지 생성 */
  if (isImageCreateRequest(q)) {
    return "image";
  }

  /* 3) 파일 형식을 명시한 경우 (파일 생성 의도가 있을 때만) */
  if (hasFileIntent(q)) {

    if (/(html|htm|웹페이지|웹 페이지|홈페이지|대시보드|dashboard)/.test(q)) return "html";
    if (/(javascript|자바스크립트|js 파일|js파일)/.test(q)) return "js";
    if (/(css 파일|css파일|스타일시트)/.test(q)) return "css";
    if (/(json 파일|json파일)/.test(q)) return "json";
    if (/(csv 파일|csv파일)/.test(q)) return "csv";
    if (/(마크다운|markdown|md 파일|md파일)/.test(q)) return "md";
    if (/(텍스트 파일|txt 파일|txt파일)/.test(q)) return "txt";
  }

  /* 4) 종류 미지정: 답변 코드블록을 보고 자동 판단 */
  if (isGenericFileRequest(q)) {
    return "auto";
  }

  return null;
}


/* =========================================================
   코드 언어 자동 판별
   ========================================================= */

function detectCodeType(answer) {

  const blocks = extractCodeBlocks(answer);

  if (!blocks.length) {
    return "txt";
  }

  const first = blocks[0];
  const lang = String(first.lang || "").toLowerCase();

  if (["html", "htm"].includes(lang)) return "html";
  if (["js", "javascript", "typescript", "ts"].includes(lang)) return "js";
  if (lang === "css") return "css";
  if (lang === "json") return "json";
  if (lang === "csv") return "csv";
  if (["md", "markdown"].includes(lang)) return "md";
  if (["txt", "text"].includes(lang)) return "txt";

  /* 언어 표시가 없을 경우 내용으로 판단 */
  const code = String(first.code || "");

  if (/<!doctype\s+html/i.test(code) || /<html[\s>]/i.test(code)) {
    return "html";
  }

  try {
    const parsed = JSON.parse(code);
    if (parsed !== null && typeof parsed === "object") {
      return "json";
    }
  } catch {}

  if (
    /[.#a-zA-Z][^{]*\{[\s\S]*:[^;]+;[\s\S]*\}/.test(code) &&
    !/(function|const|let|var|document\.|=>)/.test(code)
  ) {
    return "css";
  }

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
   텍스트/코드 파일 생성
   ========================================================= */

function fileFromAnswer(answer, type) {

  const blocks = extractCodeBlocks(answer);

  const aliases = {
    html: ["html", "htm"],
    js: ["js", "javascript", "typescript", "ts"],
    css: ["css"],
    json: ["json"],
    csv: ["csv"],
    md: ["md", "markdown"],
    txt: ["text", "txt"]
  };

  const match = aliases[type] || [type];

  const selected =
    blocks.find(x => match.includes(x.lang)) ||
    blocks[0];

  const content = selected
    ? selected.code
    : String(answer || "").trim();

  const info = {
    html: ["index.html", "text/html;charset=utf-8", "🌐"],
    js: ["script.js", "text/javascript;charset=utf-8", "🟨"],
    css: ["style.css", "text/css;charset=utf-8", "🎨"],
    json: ["data.json", "application/json;charset=utf-8", "🧩"],
    csv: ["data.csv", "text/csv;charset=utf-8", "📊"],
    md: ["document.md", "text/markdown;charset=utf-8", "📝"],
    txt: ["document.txt", "text/plain;charset=utf-8", "📄"]
  }[type] || ["document.txt", "text/plain;charset=utf-8", "📄"];

  return {
    name: info[0],
    type: info[1],
    content,
    icon: info[2]
  };
}


/* =========================================================
   PDF용 HTML 만들기
   ========================================================= */

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=block" rel="stylesheet">';

/* Chromium(서버리스)에는 한글 폰트가 없으므로 웹폰트를 강제 적용 */
const FONT_STYLE = `
<style>
html, body, body * {
  font-family: "Noto Sans KR", "Open Sans", sans-serif !important;
}
body {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  word-break: keep-all;
  overflow-wrap: anywhere;
}
pre, code {
  white-space: pre-wrap;
}
table {
  border-collapse: collapse;
}
tr, img {
  page-break-inside: avoid;
}
</style>
`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPdfHtml(answer) {

  const raw = String(answer || "").trim();

  /* 1) 코드블록 안의 HTML 우선 사용 */
  const htmlBlock = extractCodeBlocks(raw).find(
    b =>
      ["html", "htm"].includes(b.lang) ||
      /<!doctype\s+html/i.test(b.code) ||
      /<html[\s>]/i.test(b.code)
  );

  let html = htmlBlock ? htmlBlock.code.trim() : "";

  /* 2) 코드블록이 없고 본문 자체가 HTML인 경우 */
  if (!html && /<html[\s>]/i.test(raw)) {
    const start = raw.search(/<!doctype\s+html|<html[\s>]/i);
    const end = raw.toLowerCase().lastIndexOf("</html>");
    html = end > start
      ? raw.slice(start, end + 7)
      : raw.slice(start);
  }

  /* 3) 일반 텍스트 답변이면 간단한 문서로 감싼다 */
  if (!html) {

    const body = escapeHtml(
      raw
        .replace(/^```[a-z]*\s*/i, "")
        .replace(/\s*```$/i, "")
    ).replace(/\n/g, "<br>");

    html =
      '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
      "<style>@page{size:A4;margin:15mm}" +
      "body{font-size:11pt;line-height:1.7;color:#222}</style>" +
      "</head><body>" + body + "</body></html>";
  }

  /* 스크립트 제거 (서버에서 임의 JS 실행 방지 + 속도) */
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");

  /* charset 보장 */
  if (!/<meta[^>]+charset/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, m => m + '<meta charset="UTF-8">');
  }

  /* 폰트 링크 + 스타일 주입 (</head> 직전, 없으면 <head> 생성) */
  const inject = FONT_LINK + FONT_STYLE;

  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, inject + "</head>");
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(
      /<html[^>]*>/i,
      m => m + "<head><meta charset=\"UTF-8\">" + inject + "</head>"
    );
  } else {
    html =
      '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">' +
      inject + "</head><body>" + html + "</body></html>";
  }

  return html;
}


/* =========================================================
   HTML → PDF
   ========================================================= */

async function htmlToPdf(html) {

  /*
   * Chromium 패키지는 PDF를 만들 때만 불러옵니다.
   * (패키지/환경 문제가 있어도 일반 채팅은 정상 동작)
   */
  const puppeteer = (await import("puppeteer-core")).default;
  const chromium = (await import("@sparticuz/chromium")).default;

  chromium.setGraphicsMode = false;

  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({
      args: chromium.args,
      headless: "shell"
    }),
    executablePath: await chromium.executablePath(),
    headless: "shell"
  });

  try {

    const page = await browser.newPage();

    page.setDefaultTimeout(PAGE_TIMEOUT_MS);

    await page.setViewport({
      width: 1240,
      height: 1754,
      deviceScaleFactor: 1
    });

    /* 웹폰트 로딩까지 대기 (네트워크가 느리면 타임아웃 후 계속 진행) */
    try {
      await page.setContent(String(html || ""), {
        waitUntil: "networkidle0",
        timeout: PAGE_TIMEOUT_MS
      });
    } catch (e) {
      console.warn("setContent networkidle0 timeout:", e?.message);
    }

    /* 폰트 적용 완료 확인 */
    try {
      await Promise.race([
        page.evaluate(() => document.fonts.ready),
        new Promise(r => setTimeout(r, 8000))
      ]);
    } catch (e) {
      console.warn("fonts.ready error:", e?.message);
    }

    await page.emulateMediaType("print");

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "15mm",
        right: "15mm",
        bottom: "15mm",
        left: "15mm"
      }
    });

    return Buffer.from(pdf);

  } finally {
    await browser.close();
  }
}


/* =========================================================
   Data URL
   ========================================================= */

function toDataUrl(buffer, mime) {
  return `data:${mime};base64,` + buffer.toString("base64");
}


/* =========================================================
   이미지 생성
   ========================================================= */

async function createImageFile(prompt) {

  const result = await client.images.generate({
    model: "gpt-image-1",
    prompt: String(prompt || "Create the requested image."),
    size: "1024x1024"
  });

  const item = result.data?.[0];

  if (!item) {
    throw new Error("이미지 생성 결과가 없습니다.");
  }

  if (item.b64_json) {
    return {
      name: "generated-image.png",
      type: "image/png",
      dataUrl: "data:image/png;base64," + item.b64_json,
      icon: "🖼️"
    };
  }

  if (item.url) {
    return {
      name: "generated-image.png",
      type: "image/png",
      url: item.url,
      icon: "🖼️"
    };
  }

  throw new Error("이미지 데이터를 받을 수 없습니다.");
}


/* data URL → 업로드용 파일 */
async function dataUrlToFile(src, i) {

  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(String(src || ""));

  if (!m) {
    return null;
  }

  const mime = m[1].toLowerCase();
  const ext = mime.split("/")[1].replace("jpeg", "jpg");

  return toFile(
    Buffer.from(m[2], "base64"),
    `photo-${i + 1}.${ext}`,
    { type: mime }
  );
}


/* 첨부한 사진을 바탕으로 이미지 변환/편집 (예: 애니메이션풍) */
async function editImageFile(prompt, images) {

  const list = (
    await Promise.all(
      images.slice(0, 4).map((src, i) => dataUrlToFile(src, i))
    )
  ).filter(Boolean);

  if (!list.length) {
    return createImageFile(prompt);
  }

  const result = await client.images.edit({
    model: "gpt-image-1",
    image: list,
    prompt: String(prompt || "Transform this photo."),
    size: "auto",
    quality: "medium"
  });

  const item = result.data?.[0];

  if (!item?.b64_json) {
    throw new Error("이미지 변환 결과가 없습니다.");
  }

  return {
    name: "edited-image.png",
    type: "image/png",
    dataUrl: "data:image/png;base64," + item.b64_json,
    icon: "🖼️"
  };
}


/* =========================================================
   실시간(스트리밍) 응답
   - 줄바꿈(\n)으로 구분된 JSON(NDJSON)을 한 줄씩 흘려보냅니다.
   - 이벤트: status(진행 상태) / delta(글자 조각) / done(완료) / error
   - 파일 생성 요청도 스트림으로 연결을 유지해서
     오래 걸려도 응답이 끊기지 않게 합니다.
   ========================================================= */

function startNdjson(res) {

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  return obj => res.write(JSON.stringify(obj) + "\n");
}


/* OpenAI 스트림을 읽어 전체 답변을 돌려줌 (emitText=true면 글자도 실시간 전송) */
async function collectStream({ model, input, tools, write, emitText }) {

  const params = {
    model: model || "gpt-5.6",
    input,
    stream: true
  };

  if (tools && tools.length) {
    params.tools = tools;
  }

  const stream = await client.responses.create(params);

  let answer = "";
  let lastProgress = 0;

  for await (const event of stream) {

    switch (event.type) {

      case "response.output_text.delta": {

        const d = event.delta || "";
        answer += d;

        if (emitText) {

          write({ type: "delta", text: d });

        } else {

          /* 파일 내용을 만드는 동안은 진행 상황만 표시 */
          const t = Date.now();

          if (t - lastProgress > 1500) {
            lastProgress = t;
            write({
              type: "status",
              text:
                "✍️ 파일 내용을 작성하는 중… (" +
                answer.length.toLocaleString("ko-KR") + "자)"
            });
          }
        }

        break;
      }

      case "response.web_search_call.in_progress":
      case "response.web_search_call.searching":
        write({ type: "status", text: "🔎 웹에서 검색하는 중…" });
        break;

      case "response.file_search_call.in_progress":
      case "response.file_search_call.searching":
        write({ type: "status", text: "📚 등록된 자료를 찾는 중…" });
        break;

      case "response.completed":
        if (!answer && event.response?.output_text) {
          answer = event.response.output_text;
        }
        break;

      case "response.failed":
        throw new Error(
          event.response?.error?.message || "응답 생성에 실패했습니다."
        );

      case "error":
        throw new Error(event.message || "OpenAI API 오류");

      default:
        break;
    }
  }

  return answer;
}


/* =========================================================
   답변 → 파일 만들기 (이미지 / PDF / 코드·문서)
   ========================================================= */

async function buildFiles({ fileType, answer, question, images }) {

  const generatedFiles = [];

  let type = fileType;

  /* "파일로 만들어줘"처럼 종류가 없으면 답변 코드블록으로 결정 */
  if (type === "auto") {
    type = detectCodeType(answer);
  }

  /* ---------------- 이미지 ---------------- */
  if (type === "image") {

    const attached = (Array.isArray(images) ? images : [])
      .filter(x => typeof x === "string" && x.startsWith("data:image/"));

    generatedFiles.push(
      attached.length
        ? await editImageFile(question, attached)
        : await createImageFile(question)
    );

    answer = "🖼️ 이미지를 만들었어요. 아래 버튼으로 확인하고 다운로드하세요.";
  }

  /* ---------------- PDF ---------------- */
  else if (type === "pdf") {

    const pdfHtml = buildPdfHtml(answer);

    try {

      const pdf = await htmlToPdf(pdfHtml);

      if (pdf.length > MAX_PDF_BYTES) {
        throw new Error(
          `PDF 용량이 너무 큽니다. (${Math.round(pdf.length / 1024)}KB)`
        );
      }

      generatedFiles.push({
        name: "document.pdf",
        type: "application/pdf",
        dataUrl: toDataUrl(pdf, "application/pdf"),
        icon: "📕"
      });

      /* 채팅창에는 긴 HTML 대신 짧은 안내만 표시 */
      answer =
        "📕 PDF 파일을 만들었어요. 아래 버튼을 눌러 다운로드하세요.";

    } catch (pdfError) {

      console.error("PDF 생성 실패:", pdfError);

      /* 실패해도 HTML 파일은 받을 수 있게 대체 제공 */
      generatedFiles.push({
        name: "document.html",
        type: "text/html;charset=utf-8",
        content: pdfHtml,
        icon: "🌐"
      });

      answer =
        "⚠️ PDF 변환에 실패해서 HTML 파일로 대신 만들었어요.\n" +
        "다운로드한 HTML을 브라우저에서 열고 [인쇄 → PDF로 저장]을 선택하면 PDF로 만들 수 있어요.\n\n" +
        `(오류: ${pdfError?.message || "알 수 없음"})`;
    }
  }

  /* ---------------- HTML / JS / CSS / JSON / CSV / MD / TXT ---------------- */
  else if (
    ["html", "js", "css", "json", "csv", "md", "txt"].includes(type)
  ) {

    const file = fileFromAnswer(answer, type);

    generatedFiles.push(file);

    /* 코드블록이 없어서 내용이 비었다면 알려줌 */
    if (!String(file.content || "").trim()) {
      answer =
        "⚠️ 파일에 넣을 내용이 만들어지지 않았어요. 다시 요청해 주세요.\n\n" +
        answer;
    }
  }

  return { answer, files: generatedFiles };
}


/* =========================================================
   API Handler
   ========================================================= */

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY 환경변수가 없습니다."
    });
  }

  let write = null;

  try {

    const {
      model,
      question,
      history = [],
      images = [],
      files = []
    } = req.body || {};


    /* 요청 종류를 모델 호출 전에 먼저 판별 */
    const fileType = requestedFileType(question);

    const wantsStream = req.body?.stream === true;

    const current = {
      role: "user",
      content: question || "첨부한 자료를 분석해 주세요.",
      images,
      files
    };

    const developerTexts = [
      {
        type: "input_text",
        text: buildInstructions()
      }
    ];

    /* PDF 요청이면 HTML 문서만 출력하도록 추가 지침 */
    if (fileType === "pdf") {
      developerTexts.push({
        type: "input_text",
        text: buildPdfInstructions()
      });
    }

    const input = [
      {
        role: "developer",
        content: developerTexts
      },
      ...normalizeHistory(history),
      {
        role: "user",
        content: buildUserContent(current)
      }
    ];


    const vectorStoreId = await getVectorStoreId();

    const hasAttachment =
      (Array.isArray(files) && files.length > 0) ||
      (Array.isArray(images) && images.length > 0);

    /*
     * 첨부 자료로 파일을 만드는 경우(예: JSON → 대시보드 HTML)에는
     * 웹검색/자료검색이 필요 없으므로 끄고 더 빨리 만들게 합니다.
     */
    const tools =
      fileType !== null && hasAttachment
        ? []
        : [
            { type: "web_search" },
            {
              type: "file_search",
              vector_store_ids: [vectorStoreId],
              max_num_results: 8
            }
          ];


    /* ======================= 스트리밍 응답 ======================= */
    if (wantsStream) {

      write = startNdjson(res);

      /* 이미지 요청은 별도 이미지 모델만 사용 (답변 생성 생략) */
      let answer = "";

      if (fileType !== "image") {
        answer = await collectStream({
          model,
          input,
          tools,
          write,
          emitText: fileType === null
        });
      }

      if (fileType === null) {

        write({
          type: "done",
          answer: answer || "응답이 없습니다.",
          files: [],
          vector_store_id: vectorStoreId
        });

      } else {

        write({
          type: "status",
          text:
            fileType === "pdf"
              ? "📕 PDF로 변환하는 중…"
              : fileType === "image"
                ? "🖼️ 이미지를 만드는 중… (최대 1분)"
                : "📄 파일을 만드는 중…"
        });

        const out = await buildFiles({
          fileType,
          answer: answer || "응답이 없습니다.",
          question,
          images
        });

        write({
          type: "done",
          answer: out.answer,
          files: out.files,
          vector_store_id: vectorStoreId
        });
      }

      res.end();
      return;
    }


    /* ======================= 일반(한 번에) 응답 ======================= */

    let answer = "";

    if (fileType !== "image") {

      const response = await client.responses.create({
        model: model || "gpt-5.6",
        input,
        ...(tools.length ? { tools } : {})
      });

      answer = response.output_text || "응답이 없습니다.";
    }

    const out = fileType === null
      ? { answer, files: [] }
      : await buildFiles({
          fileType,
          answer,
          question,
          images
        });

    return res.status(200).json({
      answer: out.answer,
      files: out.files,
      vector_store_id: vectorStoreId
    });

  } catch (e) {

    console.error("api/chat error:", e);

    /* 이미 스트림을 시작했다면 오류도 스트림 이벤트로 전달 */
    if (write) {

      try {
        write({
          type: "error",
          error: e?.message || "OpenAI API 오류"
        });
        res.end();
      } catch {}

      return;
    }

    if (res.headersSent) {
      try { res.end(); } catch {}
      return;
    }

    return res.status(500).json({
      error: e?.message || "OpenAI API 오류"
    });
  }
}
