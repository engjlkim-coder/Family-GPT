# 가족 GPT PWA 3.0

휴대폰 중심의 가족 GPT입니다.

## 구성

- GitHub: PWA 화면과 소스 관리
- Vercel: OpenAI API를 호출하는 서버리스 백엔드
- OpenAI: GPT 응답, 이미지 분석, File Search
- Vector Store: 등록한 PDF/문서 등의 지식자료

## GitHub에 올리기

이 프로젝트 전체를 GitHub 저장소의 루트에 올립니다.

## Vercel

GitHub 저장소를 Vercel에 Import합니다.

Environment Variables에 다음을 입력합니다.

OPENAI_API_KEY = 기존 OpenAI API 키
VECTOR_STORE_ID = 사용할 OpenAI Vector Store ID

중요: API 키는 GitHub 파일에 넣지 않습니다.

## Vector Store

처음 사용할 Vector Store ID가 없다면 OpenAI 대시보드/API에서 Vector Store를 하나 만든 뒤 그 ID를 Vercel의 VECTOR_STORE_ID에 넣습니다.

## PWA

배포된 HTTPS 주소를 Android Chrome에서 열고 메뉴 → 홈 화면에 추가를 사용하면 앱처럼 사용할 수 있습니다.

## 주의

이 예제는 개인용 사용을 전제로 합니다. 여러 사람이 접근하는 공개 서비스로 만들 경우 로그인/인증과 사용량 제한을 추가해야 합니다.
