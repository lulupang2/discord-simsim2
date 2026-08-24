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
│  ┌──────────────────┐         ┌─────────────────────┐  │
│  │ Discord Message  ├────────►│ KeyedSerialQueue    │  │
│  │ Trigger Filter   │         │ (Per-Channel Sync)  │  │
│  └──────────────────┘         └──────────┬──────────┘  │
│                                          │             │
│                                          ▼             │
│                               ┌─────────────────────┐  │
│                               │ ConversationService │  │
│                               └────┬───────────┬────┘  │
│                                    │           │       │
│                  ┌─────────────────┘           └───────┼──────────┐
│                  │ (Live Stream)                       │          │
│                  ▼                                     ▼          │
│       ┌──────────────────────┐               ┌───────────────┐    │
│       │ LiveStreamWriter     │               │ Neon DB Store │    │
│       │ (800ms Buffer & Edit)│               │ & Log Sink    │    │
│       └──────────┬───────────┘               └───────┬───────┘    │
└──────────────────┼───────────────────────────────────┼────────────┘
                   │ Message.edit()                    │ Drizzle HTTP
                   ▼                                   ▼
┌──────────────────────────────┐       ┌────────────────────────────┐
│      Discord REST API        │       │  Neon Serverless Postgres  │
│  (Real-time Token Streaming) │       │   (messages & bot_logs)    │
└──────────────────────────────┘       └────────────────────────────┘
                   ▲
                   │ SSE Stream (step.delta)
┌──────────────────┴───────────┐
│ Google Gemini Interactions   │
│   API (gemini-3.7-flash)     │
└──────────────────────────────┘
```

---

## 2. 모듈별 책임 및 구조

| 모듈 경로 | 주요 책임 | 의존성 |
|---|---|---|
| `src/index.ts` | 런타임 부팅, 설정 검증, DB 핑, 컴포넌트 와이어링, SIGINT/SIGTERM 종료 처리 | 전체 모듈 |
| `src/config.ts` | 환경변수 파싱, 형식 검증, 비밀정보 노출 없는 안전한 에러 보고 | 없음 |
| `src/trigger.ts` | DM vs 서버 멘션 판별, 본인 멘션 제거, 봇/웹훅 필터링 | 없음 |
| `src/llm.ts` | Google Gemini Interactions API REST SSE 스트리밍 통신 및 델타 파싱 | `globalThis.fetch` |
| `src/stream-writer.ts` | 디스코드 초당 수정 제한을 고려한 800ms 주기 라이브 메시지 버퍼링 및 청킹 | `chunking.ts` |
| `src/conversation.ts` | 채널별 큐 직렬화, DB 기록 조회, LLM 스트림 구동, 성공 후 교환 내역 저장 | `llm.ts`, `stream-writer.ts` |
| `src/discord.ts` | `discord.js` 클라이언트 이벤트 구독 및 채널 전송/수정/타이핑 어댑터 생성 | `discord.js` |
| `src/logging.ts` | 마스킹 기반 콘솔 로깅 및 비동기 DB 로그 싱크 연결 인터페이스 | 없음 |
| `src/db/client.ts` | Neon Serverless PostgreSQL 클라이언트 생성 및 연결 헬스체크 | `@neondatabase/serverless`, `drizzle-orm` |
| `src/db/schema.ts` | Drizzle ORM 테이블 및 인덱스 정의 (`messages`, `bot_logs`) | `drizzle-orm/pg-core` |
| `src/db/conversation-store.ts` | 대화 기록 조회 및 2건의 유저/어시스턴트 메시지 일괄 INSERT | `drizzle-orm` |
| `src/db/log-sink.ts` | 시스템 로그 백그라운드 INSERT | `drizzle-orm` |
