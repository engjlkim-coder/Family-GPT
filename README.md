# 가족 GPT PWA 3.1

휴대폰 중심의 개인용 가족 GPT입니다. GitHub에 전체 소스를 보관하고 Vercel이 같은 저장소를 배포합니다.

## 3.1 주요 수정
- Vercel의 잘못된 `runtime: nodejs20.x` 설정 제거
- Node.js 24.x 지정
- OpenAI SDK 7.20.0 고정
- 지식파일 업로드 경로를 `/api/knowledge/upload`로 통일
- OpenAI `vectorStores.files.uploadAndPoll` 사용
- 현재 SDK의 Vector Store 파일 삭제 방식 적용
- 휴대폰 사진을 전송 전 축소/압축
- 지식파일은 3MB 이하로 제한 (Vercel Function 요청 크기 제한 고려)

## GitHub
ZIP을 압축 해제한 뒤 **안의 모든 파일과 폴더를 GitHub 저장소 루트에 올립니다.** ZIP 자체를 올리는 것이 아닙니다.

## Vercel
GitHub 저장소를 Vercel에서 Import합니다. Root Directory는 저장소 루트 그대로 둡니다.

Environment Variables에 다음을 추가합니다.
- `OPENAI_API_KEY` : OpenAI API 키
- `VECTOR_STORE_ID` : 사용할 OpenAI Vector Store ID (`vs_...`)

Production을 선택하고, Preview에서도 테스트하려면 Preview도 선택합니다. 환경변수 변경 후에는 반드시 다시 Deploy합니다.

## 사용
배포된 HTTPS 주소를 Android Chrome에서 열어 사용합니다. 📷/🖼️ 이미지, 📚 지식파일, JSON 대화 백업을 지원합니다.

지식파일 기능을 사용하려면 OpenAI에서 Vector Store를 하나 만들고 그 ID를 `VECTOR_STORE_ID`에 넣어야 합니다.

## 보안
OpenAI API 키는 GitHub에 넣지 않습니다. Vercel Environment Variables에만 저장합니다.
