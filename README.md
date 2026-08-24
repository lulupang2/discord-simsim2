<div align="center">

# 🐾 답장 (DiscordBot)

### **Discord + LLM API + Neon Serverless RAG 대화형 챗봇**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org/)
[![Neon Database](https://img.shields.io/badge/Neon-PostgreSQL-00E599?style=for-the-badge&logo=postgresql&logoColor=black)](https://neon.tech/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45+-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Vitest](https://img.shields.io/badge/Vitest-Tested-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)

<p align="center">
  <b>100% 완전 비동기 병렬 스트리밍</b> • <b>Neon DB 장기 기억 검색 (RAG)</b> • <b>파인튜닝 데이터셋 원클릭 추출</b>
</p>

---

</div>

<br/>

## 🌟 핵심 특징 (Key Highlights)

<table>
  <tr>
    <td width="50%">
      <h3>⚡ 완전 비동기 병렬 스트리밍</h3>
      <ul>
        <li>채널 대기 큐 없이 <b>수십 명이 동시에 질문해도 즉시 동시 처리</b></li>
        <li>Discord 메시지 실시간 편집(Live Stream Editing)으로 부드러운 타이핑 반응</li>
        <li>2,000자 초과 답변 자동 청킹(Chunking) 순차 전송</li>
      </ul>
    </td>
    <td width="50%">
      <h3>🧠 과거 대화 지능형 기억 검색 (RAG)</h3>
      <ul>
        <li>최근 20개 대화 윈도우뿐만 아니라 <b>오래전 나눈 과거 대화까지 실시간 기억</b></li>
        <li>PostgreSQL 기반 지능형 키워드 검색으로 관련 지식을 시스템 프롬프트에 자동 주입</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>📊 Fine-tuning 데이터셋 원클릭 내보내기</h3>
      <ul>
        <li>누적된 대화 데이터를 OpenAI / Qwen / Llama 파인튜닝 표준 규격인 <code>JSONL</code>(ChatML)로 즉시 덤프</li>
        <li>우리 서버 특유의 밈, 말투, 지식을 학습시킬 수 있는 데이터셋 자동 생성</li>
      </ul>
    </td>
    <td width="50%">
      <h3>💾 Neon Serverless PostgreSQL 영구 보관</h3>
      <ul>
        <li>모든 대화 이력(<code>messages</code>)과 시스템 로그(<code>bot_logs</code>)를 안전하게 영구 저장</li>
        <li>서버 재부팅 및 봇 재시작 후에도 대화 문맥 100% 유지</li>
      </ul>
    </td>
  </tr>
</table>

<br/>

## 🏗️ 시스템 아키텍처 (Architecture)

```mermaid
flowchart TB
    subgraph Discord["💬 Discord Client"]
        User["👤 유저 질문 (@안내견)"]
        StreamEdit["📝 실시간 스트림 편집 / 청크 분할"]
        Commands["⚙️ !학습통계 / !기억 <키워드>"]
    end

    subgraph BotService["🚀 GuideDog Bot Engine (Node.js 20+ TS)"]
        Handler["🎯 Message Handler (완전 비동기 병렬)"]
        RAG["🔍 RAG Context Retriever (지식 검색)"]
        Conversation["🤖 Conversation Service"]
        StreamWriter["✍️ LiveStreamWriter"]
    end

    subgraph LLM["🌐 OpenAI 호환 LLM Provider"]
        TokenRouter["⚡ TokenRouter (Qwen 3.8 Max / OpenAI / Gemini)"]
    end

    subgraph NeonDB["🐘 Neon Serverless PostgreSQL"]
        MessagesTable[("📚 messages (대화 이력)")]
        LogsTable[("📋 bot_logs (시스템 로그)")]
    end

    User --> Handler
    Commands --> Handler
    Handler --> RAG
    RAG <--> MessagesTable
    Handler --> Conversation
    Conversation --> TokenRouter
    TokenRouter -- "Delta 스트리밍" --> StreamWriter
    StreamWriter --> StreamEdit
    Conversation -- "완료된 대화 저장" --> MessagesTable
    BotService -- "비동기 로그 기록" --> LogsTable
```

<br/>

## 🎮 디스코드 내장 명령어 (In-Discord Commands)

채팅방에서 봇을 멘션하지 않고 명령어만 입력해도 즉시 실행됩니다.

| 명령어                     | 설명                                                              | 실행 예시                      |
| :------------------------- | :---------------------------------------------------------------- | :----------------------------- |
| `!학습통계` / `!데이터셋`  | DB에 누적된 대화 건수, 질문/답변 비율, 학습 데이터 통계 카드 출력 | `!학습통계`                    |
| `!기억 <키워드>` / `!검색` | 과거 대화 및 지식 데이터베이스에서 관련 기록 실시간 검색          | `!기억 날씨`                   |
| `@안내견 <질문>`           | 봇과 일반 대화 (실시간 스트리밍 & RAG 자동 적용)                  | `@안내견 오늘 점심 뭐 먹을까?` |

<br/>

## 🛠️ 환경 변수 설정 (`.env`)

프로젝트 루트의 `.env` 파일에 아래 설정을 입력합니다:

```env
# [필수] 디스코드 봇 토큰
DISCORD_TOKEN=your-discord-bot-token

# [필수] LLM API 키 및 모델명
LLM_API_KEY=your-api-key
LLM_MODEL=qwen/qwen3.8-max-free

# [선택] LLM API 엔드포인트 (기본값: https://api.tokenrouter.com/v1)
LLM_BASE_URL=https://api.tokenrouter.com/v1

# [필수] Neon PostgreSQL 데이터베이스 URL
DATABASE_URL=postgresql://user:password@ep-xyz.ap-southeast-1.aws.neon.tech/neondb?sslmode=require

# [선택] 봇 시스템 프롬프트 (성격 및 페르소나)
BOT_SYSTEM_PROMPT=너는 디스코드 대화형 어시스턴트 봇 안내견이야. 항상 친절하고 재치있게 답변해줘.

# [선택] LLM에 전달할 최근 대화 문맥 개수 (기본값: 20)
MAX_HISTORY_MESSAGES=20
```

<br/>

## 🚀 빠른 시작 (Quick Start)

```bash
# 1. 패키지 설치
npm install

# 2. 데이터베이스 스키마 마이그레이션
npm run db:migrate

# 3. 테스트 및 타입체크 (100% 통과 확인)
npm test
npm run typecheck

# 4. 빌드 & 실행
npm run build
npm start
```

<br/>

## 📦 데이터셋 & 인제스트 CLI 도구

### 1. 📊 파인튜닝 데이터셋 원클릭 추출 (`export-dataset`)

Neon DB에 쌓인 대화 데이터를 OpenAI / Qwen / Llama 학습용 JSONL 파일(`discord-finetuning-dataset.jsonl`)로 추출합니다.

```bash
npm run export-dataset
```

```yaml
# 실행 결과 미리보기
=========================================
📊 Neon DB 대화 데이터셋 통계
=========================================
- 총 메시지 수: 1,420 건
- 사용자 질문: 710 건
- 봇 답변: 710 건
- 참여 채널 수: 4 개
- 최초 대화: 2026-08-24T18:53:03.250Z
- 최근 대화: 2026-08-25T04:10:12.100Z
=========================================
✅ 데이터셋 추출 완료: ./discord-finetuning-dataset.jsonl
- 추출된 학습 샘플 수: 710 세션
- 포맷: OpenAI / Qwen / Llama Fine-tuning 호환 JSONL (ChatML)
```

<br/>

### 2. 📥 과거 디스코드 대화 대량 수집 (`ingest-channel`)

디스코드 채널에 남아있는 과거 수백~수천 개의 대화를 긁어와 Neon DB에 일괄 인제스트합니다.

```bash
npm run ingest-channel <채널ID> [수집개수]

# 예시: 해당 채널의 최근 500개 메시지를 색인
npm run ingest-channel 216136126476320769 500
```

<br/>

## 🗄️ 데이터베이스 스키마 (Database Schema)

```
┌─────────────────────────────────────────────────────────────┐
│                       messages                              │
├──────────────────┬─────────────────┬────────────────────────┤
│ id (BigSerial)   │ PK              │ 자동 증가 고유 번호     │
│ channel_id       │ Text (Indexed)  │ 디스코드 채널 ID       │
│ guild_id         │ Text            │ 디스코드 서버 ID       │
│ author_id        │ Text            │ 작성자 유저 ID         │
│ role             │ Enum            │ 'user' | 'assistant'   │
│ content          │ Text            │ 메시지 본문            │
│ created_at       │ Timestamptz     │ 메시지 생성 일시       │
└──────────────────┴─────────────────┴────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       bot_logs                              │
├──────────────────┬─────────────────┬────────────────────────┤
│ id (BigSerial)   │ PK              │ 자동 증가 고유 번호     │
│ level            │ Enum            │ 'info' | 'warn' | 'error'│
│ message          │ Text            │ 로그 메시지 본문       │
│ context          │ JSONB           │ 구조화된 에러/메타데이터│
│ created_at       │ Timestamptz     │ 로그 기록 일시         │
└──────────────────┴─────────────────┴────────────────────────┘
```

<br/>

## 🐧 Linux systemd 백그라운드 서비스 등록

서버에서 24시간 상시 가동하기 위한 systemd 설정 (`/etc/systemd/system/discord-bot.service`):

```ini
[Unit]
Description=Discord GuideDog Chatbot Service
After=network.target

[Service]
Type=simple
User=work
WorkingDirectory=/home/work/discord-bot
EnvironmentFile=/home/work/discord-bot/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
# 서비스 등록 및 활성화
sudo systemctl daemon-reload
sudo systemctl enable --now discord-bot

# 실시간 로그 스트리밍 확인
sudo journalctl -u discord-bot -f
```

<br/>

## 🧪 테스트 (Testing)

```bash
# Vitest 단위 테스트 실행 (네트워크/외부 의존성 없는 완전 결정론적 테스트)
npm test

# TypeScript 타입 안전성 검증
npm run typecheck
```

---

<div align="center">
  <sub>Built with ❤️ by GuideDog Team • Licensed under MIT</sub>
</div>
