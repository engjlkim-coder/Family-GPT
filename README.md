# 가족 GPT PWA 3.3

- 하단 📎 첨부 버튼 하나에서 사진 촬영, 사진/이미지 선택, 지식파일 업로드, 등록된 지식 확인을 모두 사용합니다.
- `VECTOR_STORE_ID`를 직접 입력하지 않아도 됩니다.
- 서버는 `VECTOR_STORE_NAME`(기본 `family-gpt-pwa-knowledge`)으로 기존 Vector Store를 찾고, 없으면 자동 생성해 재사용합니다.
- 기존 `VECTOR_STORE_ID`를 넣어 두면 그 ID를 우선 사용합니다.
- 지식파일은 업로드 후 Vector Store에 자동 등록됩니다.
- 질문에는 자동으로 File Search가 연결됩니다.
- 이미지 첨부는 질문과 함께 모델에 전달됩니다.

## Vercel 환경변수
필수: `OPENAI_API_KEY`

선택:
- `VECTOR_STORE_ID` : 기존 Vector Store를 지정할 경우
- `VECTOR_STORE_NAME` : 자동 관리 Vector Store 이름 변경 시

새 설치라면 `OPENAI_API_KEY`만 설정하면 됩니다.

주의: Vector Store는 OpenAI API 리소스이므로 저장/검색에 따른 비용이 발생할 수 있습니다.
