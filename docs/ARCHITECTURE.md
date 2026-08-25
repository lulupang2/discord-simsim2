# System Architecture & Component Design

---

## 1. 상위 아키텍처 다이어그램

```
┌────────────────────────────────────────────────────────┐
│                     Discord Client                     │
│               (Server Channel / User DM)               │
└───────────────────────────┬────────────────────────────┘
                            │ Gateway Events (WebSocket)
                            ▼
┌────────────────────────────────────────────────────────┐
│             Discord Bot Application (Node.js)          │
│                                                        │
│  ┌──────────────────────┐   ┌────────────────────────┐ │
│  │ Discord Message      ├──►│ Speaker Attributor     │ │
│  │ Trigger & Attachment │   │ (Nick/Global/Username) │ │
│  └──────────────────────┘   └──────────┬─────────────┘ │
│                                        │               │
│                                        ▼               │
│                             ┌────────────────────────┐ │
│                             │ User Style Analyzer    │ │
│                             │ (Tone / Length / Emoji)│ │
│                             └──────────┬─────────────┘ │
│                                        │               │
│                                        ▼               │
│                             ┌────────────────────────┐ │
│                             │ ConversationService    │ │
│                             └────┬───────────┬───────┘ │
│                                  │           │         │
│                ┌─────────────────┘           └───────┼──────────┐
│                │ (Live Stream)                       │          │
│                ▼                                     ▼          │
│     ┌──────────────────────┐               ┌───────────────┐    │
│     │ LiveStreamWriter     │               │ Neon DB Store │    │
│     │ (800ms Buffer & Edit)│               │ & Log Sink    │    │
│     └──────────┬───────────┘               └───────┬───────┘    │
│                │                                   │            │
│  ┌─────────────┴───────────────────────────────────┼─────────┐  │
│  │ ElysiaJS Web Dashboard Server (Port: 23006)     │         │  │
│  │  - Realtime Stats & Message / Log Viewer        │         │  │
│  │  - User Style Analytics Viewer                  │         │  │
│  │  - Runtime Settings & Presets CRUD / Live Test  │         │  │
│  └─────────────────────────────────────────────────┼─────────┘  │
└────────────────┼───────────────────────────────────┼────────────┘
                 │ Message.edit()                    │ Drizzle HTTP
                 ▼                                   ▼
┌──────────────────────────────┐       ┌────────────────────────────┐
│      Discord REST API        │       │  Neon Serverless Postgres  │
│  (Real-time Token Streaming) │       │   (messages & bot_logs)    │
└──────────────────────────────┘       └────────────────────────────┘
                 ▲
                 │ Chat Completions + Web Search Tool
┌────────────────┴───────────────┐
│ OpenRouter / OpenAI Compatible │
│ (Solar Pro 4, Qwen, DeepSeek)  │
└────────────────────────────────┘
```

---

## 2. 모듈별 책임 및 구조

| 모듈 경로 | 주요 책임 | 의존성 |
|---|---|---|
| `src/index.ts` | 런타임 부팅, 설정 검증, DB 핑, 컴포넌트 와이어링, Elysia 대시보드 기동, SIGINT/SIGTERM 종료 처리 | 전체 모듈 |
| `src/config.ts` | 환경변수 파싱, 형식 검증, 비밀정보 노출 없는 안전한 에러 보고 | 없음 |
| `src/trigger.ts` | DM vs 서버 멘션 판별, 첨부파일 유무 감지, 본인 멘션 제거, 봇/웹훅 필터링 | 없음 |
| `src/chat-style.ts` | 유저 최근 발화 기반 결정론적 말투(반말/존댓말), 문장길이, 이모지, 추임새 분석기 | 없음 |
| `src/llm.ts` | OpenAI 호환 REST SSE 스트리밍, OpenRouter `web_search` 도구 주입, 출처 링크 파싱, 멀티모달 비전 지원, 오류 폴백 추출 | `globalThis.fetch` |
| `src/llm-settings.ts` | 런타임 설정 검증, JSON 파일 영속화, 설정 프리셋(Presets) CRUD 및 마스킹 처리 | `node:fs/promises` |
| `src/stream-writer.ts` | 디스코드 초당 수정 제한을 고려한 800ms 주기 라이브 메시지 버퍼링 및 청킹 | `chunking.ts` |
| `src/conversation.ts` | 대화 맥락 조립, 발화자 닉네임 접두사 태깅, 유저 스타일 프롬프트 주입, LLM 스트림 구동, 성공 후 교환 내역 저장 | `llm.ts`, `stream-writer.ts`, `chat-style.ts` |
| `src/discord.ts` | `discord.js` 이벤트 구독, 이미지 첨부파일 추출, 표시 이름 추출, 채널 전송/수정/타이핑 어댑터 생성 | `discord.js` |
| `src/logging.ts` | 마스킹 기반 콘솔 로깅 및 비동기 DB 로그 싱크 연결 인터페이스 | 없음 |
| `src/db/client.ts` | Neon Serverless PostgreSQL 클라이언트 생성 및 연결 헬스체크 | `@neondatabase/serverless`, `drizzle-orm` |
| `src/db/schema.ts` | Drizzle ORM 테이블 및 인덱스 정의 (`messages`, `bot_logs`, `author_name` 컬럼 포함) | `drizzle-orm/pg-core` |
| `src/db/conversation-store.ts` | 대화 기록 조회/저장, 사용자 발화 스타일 집계(`listUserChatStyles`), RAG 키워드 검색, 데이터셋 덤프 | `drizzle-orm`, `chat-style.ts` |
| `src/db/log-sink.ts` | 시스템 로그 백그라운드 INSERT | `drizzle-orm` |
| `src/server/index.ts` | ElysiaJS 기반 REST API 라우팅 (통계, 대화로그, 시스템로그, RAG 테스터, 설정 및 프리셋 CRUD) | `elysia`, `@elysiajs/node` |
| `src/server/dashboard-html.ts` | 실시간 반응형 관리자 웹 대시보드 단일 HTML/CSS/JS 템플릿 | 없음 |
