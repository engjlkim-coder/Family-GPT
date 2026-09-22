가족 GPT 3.3 수정 파일 패치

기존 3.2 프로젝트에서 아래 파일만 교체하세요.
- index.html
- api/chat.js
- api/_vectorStore.js (자동 Vector Store 생성/재사용)
- api/knowledge.js
- api/knowledge/upload.js
- api/knowledge/[id].js

수정 내용
1. 질문창 옆 📎 첨부 메뉴가 실제로 표시되도록 수정
2. 사진 촬영/이미지 선택/지식파일 등록/등록된 지식자료 보기를 📎 메뉴로 통합
3. 후속 질문에서 assistant 이력을 output_text로 전달하도록 수정하여 inputtext 400 오류 방지
4. Vector Store ID를 환경변수에 직접 넣지 않아도 자동 생성/재사용
5. 지식파일 목록/업로드/삭제도 자동 Vector Store를 사용

환경변수: OPENAI_API_KEY만 필수입니다.
기존 VECTOR_STORE_ID를 사용하고 싶다면 선택적으로 설정할 수 있습니다.
