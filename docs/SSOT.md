# Single Source of Truth (SSOT)

> 프로젝트명: **Discord LLM Chatbot (답장 / Dapjang)**  
> 기준일: 2026-08-25  
> 저장소: `https://github.com/lulupang2/discord-simsim2.git`  
> 배포 호스트: Rocky Linux 10.2 (`45.151.152.179`)

---

## 1. 시스템 핵심 정의 및 철학

1. **단일 목적**: Discord 대화형 AI 봇으로, 채널/DM별 독립된 대화 맥락을 유지하고 고속 실시간 스트리밍으로 답변을 전달한다.
2. **다중 LLM 및 공급자 호환**: OpenRouter (Upstage Solar Pro 4, DeepSeek, Gemini 등) 및 TokenRouter (Qwen) 등 표준 OpenAI 호환 Chat Completions REST 엔드포인트를 기반으로 동작한다.
3. **분리된 영속화 & 프롬프트 맥락**:
   - **영구 보관**: 모든 사용자 질문과 봇 답변은 Neon PostgreSQL (`messages`) 테이블에 무제한 누적 저장한다.
   - **프롬프트 입력**: LLM API 호출 시에는 최근 `MAX_HISTORY_MESSAGES`(기본 20개)와 RAG 검색 과거 지식을 시스템 프롬프트에 결합하여 전달한다.
4. **다자간 발화자 인지 (Speaker Attribution)**:
   - 디스코드 서버 별명 → 글로벌 이름 → 유저네임 순으로 발화자 표시명을 추출하여 `이름: 내용` 형식으로 LLM에 전달한다.
   - DB에는 원본 메시지만 저장하여 파인튜닝 데이터셋의 오염을 방지한다.
5. **유저 채팅 스타일 실시간 분석 (Chat Style Profiling)**:
   - 유저의 최근 발화 최대 100건을 결정론적으로 분석(말투·문장길이·이모지·표현)하여 맞춤 톤 지침을 시스템 프롬프트에 자동 주입한다 (추가 LLM 비용 0원).
6. **OpenRouter 실시간 웹검색 & 출처 링크**:
   - `openrouter:web_search` Server Tool을 통해 모델이 최신 정보가 필요할 때만 선별 검색을 수행하고, 응답 하단에 출처 마크다운 링크를 자동 첨부한다.
7. **멀티모달 이미지 인식 (Vision)**:
   - 디스코드 이미지 첨부파일(`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`)을 감지하여 Vision 지원 모델로 전달한다.
8. **관리자 웹 대시보드 (ElysiaJS)**:
   - 초경량 Node.js 기반 관리자 웹 대시보드를 제공하며, 서버 재시작 없이 런타임 설정 및 프리셋을 원클릭으로 핫스왑한다.
9. **Fail-Fast & 안전한 오류 격리**:
   - 비밀정보(API 키, 토큰, DB 접속 URL)는 로그 및 대시보드 조회 시 `[REDACTED]` 또는 마스킹 처리한다.

---

## 2. 기술 스택 표준

| 영역 | 기술 / 도구 | 버전 / 비고 |
|---|---|---|
| **Runtime** | Node.js | `>=20.0.0` (운영 서버: `v22.23.1`) |
| **Language** | TypeScript | `v5.x` / `v7.x` (Strict mode, `NodeNext`) |
| **Discord Transport** | `discord.js` | `^14.27.0` (Gateway Intents 기반) |
| **Web Server / Dashboard** | ElysiaJS (`@elysiajs/node`) | `^1.4.29` (경량 관리자 웹 대시보드) |
| **LLM Provider** | OpenAI 호환 REST API | OpenRouter (`upstage/solar-pro4` 등), TokenRouter |
| **Database** | Neon Serverless PostgreSQL | PostgreSQL 16+ 호환 |
| **ORM / Query** | Drizzle ORM / Drizzle Kit | `drizzle-orm`, `@neondatabase/serverless` |
| **Testing** | Vitest | `^4.1.11` (100% 무네트워크 결정론적 테스트, 78개 통과) |
| **Process Manager** | systemd | `discord-bot.service` (Rocky Linux) |

---

## 3. 환경 변수 명세

| 변수명 | 필수 여부 | 기본값 | 설명 |
|---|:---:|---|---|
| `DISCORD_TOKEN` | **필수** | - | Discord Developer Portal 발급 봇 토큰 |
| `LLM_API_KEY` | **필수** | - | OpenRouter / TokenRouter 등 LLM API 키 |
| `LLM_MODEL` | **필수** | `qwen/qwen3.8-max-free` | 사용할 기본 모델 식별자 (예: `upstage/solar-pro4`) |
| `DATABASE_URL` | **필수** | - | Neon PostgreSQL 연결 URL (`sslmode=require`) |
| `LLM_BASE_URL` | 선택 | `https://api.tokenrouter.com/v1` | LLM 엔드포인트 (OpenRouter: `https://openrouter.ai/api/v1`) |
| `LLM_MAX_TOKENS` | 선택 | `300` | 최대 생성 토큰 수 상한 |
| `MAX_HISTORY_MESSAGES` | 선택 | `20` | LLM에 전달할 최근 대화 메시지 수 상한 |
| `BOT_SYSTEM_PROMPT` | 선택 | - | 매 요청에 포함할 시스템 페르소나/프롬프트 |
| `PORT` | 선택 | `3000` | Elysia 관리자 웹 대시보드 포트 (운영: `23006`) |

---

## 4. 데이터베이스 스키마 정의 (Neon PostgreSQL)

### 4.1. `messages` (대화 영구 저장)
- `id` (bigserial, PK): 자동 증가 고유 식별자
- `channel_id` (text, Not Null): Discord 채널 또는 DM ID
- `guild_id` (text, Nullable): 서버 ID (DM의 경우 null)
- `author_id` (text, Not Null): 발화자 Discord 사용자 ID
- `author_name` (text, Nullable): 발화자 Discord 표시 이름/닉네임
- `role` (enum `'user' | 'assistant'`, Not Null): 발화 주체
- `content` (text, Not Null): 메시지 본문 (원본 텍스트 보존)
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
   - 1:1 개인 DM: 모든 비공백 메시지 및 이미지 첨부 메시지에 응답.
   - 서버(길드) 채널: 반드시 봇의 본인 멘션(`<@봇ID>` 또는 `<@!봇ID>`)이 포함된 경우에만 응답.
   - 봇/웹훅 작성 메시지 및 멘션 제거 후 텍스트/첨부파일이 모두 없는 메시지는 무조건 무시.
2. **완전 비동기 병렬 실행**:
   - 채널 간 및 동일 채널 내에서도 요청을 블로킹하지 않고 비동기 병렬로 처리한다.
3. **메시지 전송 성공 후 DB 커밋**:
   - Discord 메시지 전송이 완료되기 전이나 전송 실패 시에는 대화 내역(`messages`)을 커밋하지 않아 오염을 방지한다.
4. **멘션 핑 방지 (`allowedMentions: { parse: [] }`)**:
   - LLM이 생성한 텍스트에 `@everyone`, `@here` 또는 역할/유저 멘션이 포함되어 있어도 실제 디스코드 알림이 울리지 않도록 전송 시 멘션 파싱을 차단한다.
