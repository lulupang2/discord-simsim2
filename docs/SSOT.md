# Single Source of Truth (SSOT)

> 프로젝트명: **Discord LLM Chatbot (안내견)**  
> 기준일: 2026-08-25  
> 저장소: `https://github.com/lulupang2/discord-simsim2.git`  
> 배포 호스트: Rocky Linux 10.2 (`45.151.152.179`)

---

## 1. 시스템 핵심 정의 및 철학

1. **단일 목적**: Discord 대화형 AI 봇으로, 채널/DM별 독립된 대화 맥락을 유지하고 고속 실시간 스트리밍으로 답변을 전달한다.
2. **최소 의존성 & 최대 안정성**: 별도의 거대한 백엔드 프레임워크(NestJS, Express 등) 없이 `discord.js`와 Node.js 네이티브 런타임으로 동작하는 상시 실행 백그라운드 워커 형태를 유지한다.
3. **분리된 영속화 & 프롬프트 맥락**:
   - **영구 보관**: 모든 사용자 질문과 봇 답변은 Neon PostgreSQL (`messages`) 테이블에 무제한 누적 저장한다.
   - **프롬프트 입력**: LLM API 호출 시에는 최근 `MAX_HISTORY_MESSAGES`(기본 20개)만 추출하여 전달하여 토큰 비용과 대기 시간을 최적화한다.
4. **실시간 SSE 스트리밍 & 실시간 편집**:
   - Google 공식 **Gemini Interactions API (`/v1beta/interactions?alt=sse`)**를 사용한다.
   - 토큰이 생성되는 즉시 수신하여 Discord 메시지를 700~1,000ms 간격으로 라이브 수정(`Message.edit`)하여 응답 체감 지연시간(TTFT)을 극소화한다.
5. **Fail-Fast & 안전한 오류 격리**:
   - 필수 환경변수 누락 시 즉시 실패하여 안전하지 않은 상태의 가동을 방지한다.
   - 런타임 오류는 절대 비밀정보(API 키, 토큰, DB 접속 URL)를 로그에 노출하지 않으며 `[REDACTED]` 처리한다.

---

## 2. 기술 스택 표준

| 영역 | 기술 / 도구 | 버전 / 비고 |
|---|---|---|
| **Runtime** | Node.js | `>=20.0.0` (운영 서버: `v22.23.1`) |
| **Language** | TypeScript | `v5.x` / `v7.x` (Strict mode, `NodeNext`) |
| **Discord Transport** | `discord.js` | `^14.27.0` (Gateway Intents 기반) |
| **LLM Provider** | Google Gemini Interactions API | `gemini-3.7-flash` (Interactions REST SSE) |
| **Database** | Neon Serverless PostgreSQL | PostgreSQL 16+ 호환 |
| **ORM / Query** | Drizzle ORM / Drizzle Kit | `drizzle-orm`, `@neondatabase/serverless` |
| **Testing** | Vitest | `^4.1.11` (100% 무네트워크 결정론적 테스트) |
| **Process Manager** | systemd | `discord-bot.service` (Rocky Linux) |

---

## 3. 환경 변수 명세

| 변수명 | 필수 여부 | 기본값 | 설명 |
|---|:---:|---|---|
| `DISCORD_TOKEN` | **필수** | - | Discord Developer Portal 발급 봇 토큰 |
| `LLM_API_KEY` (또는 `GEMINI_API_KEY`) | **필수** | - | Google AI Studio 발급 Gemini API 키 |
| `DATABASE_URL` | **필수** | - | Neon PostgreSQL 연결 URL (`sslmode=require`) |
| `LLM_MODEL` (또는 `GEMINI_MODEL`) | 선택 | `gemini-3.7-flash` | 사용할 Gemini 모델 식별자 |
| `LLM_BASE_URL` | 선택 | `https://generativelanguage.googleapis.com` | Gemini Interactions API 루트 |
| `LLM_THINKING_LEVEL` | 선택 | `low` | `minimal`, `low`, `medium`, `high` 중 선택 |
| `MAX_HISTORY_MESSAGES` | 선택 | `20` | LLM에 전달할 최근 대화 메시지 수 상한 |
| `BOT_SYSTEM_PROMPT` | 선택 | - | 매 요청에 포함할 시스템 페르소나/프롬프트 |

---

## 4. 데이터베이스 스키마 정의 (Neon PostgreSQL)

### 4.1. `messages` (대화 영구 저장)
- `id` (bigserial, PK): 자동 증가 고유 식별자
- `channel_id` (text, Not Null): Discord 채널 또는 DM ID
- `guild_id` (text, Nullable): 서버 ID (DM의 경우 null)
- `author_id` (text, Not Null): 발화자 Discord 사용자 ID
- `role` (enum `'user' | 'assistant'`, Not Null): 발화 주체
- `content` (text, Not Null): 메시지 본문
- `created_at` (timestamptz, Not Null): 생성 시각 (기본값 `now()`)
- **Index**: `messages_channel_created_id_idx` (`channel_id`, `created_at DESC`, `id DESC`)

### 4.2. `bot_logs` (시스템 로그 영구 저장)
- `id` (bigserial, PK): 자동 증가 고유 식별자
- `level` (enum `'info' | 'warn' | 'error'`, Not Null): 로그 등급
- `message` (text, Not Null): 로그 메시지 요약
- `context` (jsonb, Nullable): 구조화된 부가 정보 (비밀정보 마스킹 완료본)
- `created_at` (timestamptz, Not Null): 로그 기록 시각 (기본값 `now()`)
- **Index**: `bot_logs_created_id_idx` (`created_at DESC`, `id DESC`)

---

## 5. 핵심 불변 규칙 (Invariants)

1. **멘션 및 트리거 규칙**:
   - 1:1 개인 DM: 모든 비공백 메시지에 응답.
   - 서버(길드) 채널: 반드시 봇의 본인 멘션(`<@봇ID>` 또는 `<@!봇ID>`)이 포함된 경우에만 응답.
   - 봇/웹훅 작성 메시지 및 멘션 제거 후 공백만 남은 메시지는 무조건 무시.
2. **요청 직렬화 (Serialization)**:
   - 동일 채널 내에서는 이전 질문 처리가 완료되기 전까지 다음 질문이 순차 큐에서 대기하여 대화 순서와 기록 정합성을 보장한다.
   - 서로 다른 채널 간에는 완전히 병렬로 독립 처리된다.
3. **메시지 전송 성공 후 DB 커밋**:
   - Discord 메시지 전송이 완료되기 전이나 전송 실패 시에는 대화 내역(`messages`)을 커밋하지 않아 오염을 방지한다.
4. **멘션 핑 방지 (`allowedMentions: { parse: [] }`)**:
   - LLM이 생성한 텍스트에 `@everyone`, `@here` 또는 역할/유저 멘션이 포함되어 있어도 실제 디스코드 알림이 울리지 않도록 전송 시 멘션 파싱을 차단한다.
