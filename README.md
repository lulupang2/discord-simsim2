<div align="center">

# 🐾 답장 (Dapjang Bot)

### **Discord + Multi-LLM + Web Search + Neon Serverless RAG 지능형 대화 챗봇**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.js.org/)
[![ElysiaJS](https://img.shields.io/badge/ElysiaJS-1.4+-FD8BE9?style=for-the-badge&logo=elysia&logoColor=black)](https://elysiajs.com/)
[![Neon Database](https://img.shields.io/badge/Neon-PostgreSQL-00E599?style=for-the-badge&logo=postgresql&logoColor=black)](https://neon.tech/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45+-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Vitest](https://img.shields.io/badge/Vitest-72_Passed-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)

<p align="center">
  <b>100% 완전 비동기 병렬 스트리밍</b> • <b>발화자 구분 & 채팅 스타일 자동 분석</b> • <b>OpenRouter 실시간 웹검색</b> • <b>관리자 웹 대시보드 & 프리셋</b>
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
      <h3>👥 다자간 발화자 자동 구분</h3>
      <ul>
        <li>서버 별명(displayName) → 글로벌 이름 → 유저네임 순 자동 추출</li>
        <li>과거 이력과 현재 질문에 발화자 태깅하여 <b>누가 무슨 말을 했는지 100% 인지</b></li>
        <li>DB에는 원본 그대로 저장하여 파인튜닝 데이터셋 오염 방지</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🌐 OpenRouter 실시간 웹검색 & 출처 링크</h3>
      <ul>
        <li><b>Solar Pro 4</b>(<code>upstage/solar-pro4</code>), DeepSeek 등 모델 지원</li>
        <li><code>openrouter:web_search</code> 도구로 <b>최신 정보가 필요할 때만 선별 검색</b></li>
        <li>응답 본문 하단에 신뢰할 수 있는 <b>출처 마크다운 링크 자동 첨부</b></li>
      </ul>
    </td>
    <td width="50%">
      <h3>🎨 유저 채팅 스타일 실시간 분석</h3>
      <ul>
        <li>사용자별 최근 발화 100건을 기반으로 말투·문장길이·이모지·표현(<code>ㅋㅋ</code> 등) 자동 분석</li>
        <li>추가 LLM 비용 없이 <b>유저의 대화 텐션에 자연스럽게 맞춘 응답</b> 유도</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🖥️ 관리자 웹 대시보드 & 프리셋 관리</h3>
      <ul>
        <li><b>ElysiaJS</b> 기반 초경량 실시간 웹 대시보드 (통계, 대화 로그, 웹 플레이그라운드)</li>
        <li><b>런타임 설정 프리셋 추가 / 수정 / 삭제 / 원클릭 적용</b> (연결 테스트 자동 검증)</li>
        <li>서버 재시작 없이 웹에서 모델·Base URL·프롬프트 즉시 스왑</li>
      </ul>
    </td>
    <td width="50%">
      <h3>🧠 Neon DB 영구 기억 & 데이터셋 내보내기</h3>
      <ul>
        <li>대화 이력과 시스템 로그를 <b>Neon Serverless PostgreSQL</b>에 영구 보존</li>
        <li>키워드 기반 RAG로 과거 채널 지식 자동 검색</li>
        <li>OpenAI / Qwen / Llama 표준 <code>JSONL</code>(ChatML) <b>원클릭 학습 데이터 추출</b></li>
      </ul>
    </td>
  </tr>
</table>

<br/>

## 🏗️ 시스템 아키텍처 (Architecture)

```mermaid
flowchart TB
    subgraph Discord["💬 Discord Gateway"]
        User["👤 유저 질문 (@답장)"]
        StreamEdit["📝 실시간 스트림 편집 / 청크 분할"]
        Commands["⚙️ !학습통계 / !기억 <키워드>"]
    end

    subgraph BotEngine["🚀 Bot Core Engine (Node.js 20+ TS)"]
        Handler["🎯 Message Handler (완전 비동기 병렬)"]
        Attributor["🏷️ Speaker Attributor (닉네임 추출 & 태깅)"]
        StyleAnalyzer["📊 User Chat Style Analyzer (말투·패턴 분석)"]
        RAG["🔍 RAG Context Retriever (지식 검색)"]
        Conversation["🤖 Conversation Service"]
        StreamWriter["✍️ LiveStreamWriter"]
    end

    subgraph LLM["🌐 OpenRouter / OpenAI 호환 LLM"]
        Provider["⚡ Model (Solar Pro 4 / Qwen / DeepSeek)"]
        WebSearch["🔍 OpenRouter Web Search Tool (Exa / Native)"]
    end

    subgraph AdminUI["🖥️ ElysiaJS Web Dashboard (:PORT)"]
        Dashboard["📊 통계 · 실시간 피드 · 시스템 로그"]
        Playground["🧪 웹 RAG 테스트 챗"]
        PresetManager["⚙️ 런타임 설정 & 프리셋 CRUD / 적용"]
    end

    subgraph NeonDB["🐘 Neon Serverless PostgreSQL"]
        MessagesTable[("📚 messages (대화 이력 & 발화자)")]
        LogsTable[("📋 bot_logs (시스템 로그)")]
    end

    User --> Handler
    Commands --> Handler
    Handler --> Attributor
    Attributor --> StyleAnalyzer
    Handler --> RAG
    RAG <--> MessagesTable
    Handler --> Conversation
    StyleAnalyzer -.-> Conversation
    Conversation --> Provider
    Provider <--> WebSearch
    Provider -- "Delta 스트리밍 & 출처" --> StreamWriter
    StreamWriter --> StreamEdit
    Conversation -- "완료된 대화 저장" --> MessagesTable
    BotEngine -- "비동기 로그 기록" --> LogsTable

    AdminUI <--> MessagesTable
    AdminUI <--> LogsTable
    PresetManager -. "설정 핫스왑" .-> Provider
```

<br/>

## 🖥️ 관리자 웹 대시보드 (Admin Dashboard)

봇 실행 시 내장 웹 서버가 가동되어 브라우저에서 봇을 관리하고 테스트할 수 있습니다:

- **접속 주소**: `http://<서버IP>:<PORT>` (기본 포트: `.env`의 `PORT`)

```
┌────────────────────────────────────────────────────────────────────────┐
│  🐾 Dapjang Admin Dashboard                                           │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────┤
│  📊 대시보드  │  📚 대화기록  │  📋 시스템로그 │  🧪 테스터    │  ⚙️ 설정    │
└──────────────┴──────────────┴──────────────┴──────────────┴────────────┘
```

1. **📊 대시보드 (Overview)**: 누적 메시지 수, 질문/답변 비율, 참여 채널 수, 활성 모델, 실시간 대화 피드
2. **📚 대화기록 (Messages)**: 채널별 전체 대화 열람 + **사용자별 채팅 스타일 분석 통계표**
3. **📋 시스템로그 (Logs)**: INFO / WARN / ERROR 레벨별 실시간 서버 로그 검색
4. **🧪 대화형 테스터 (Playground)**: 디스코드 없이 웹에서 봇의 실시간 RAG 대화 테스트
5. **⚙️ 런타임 설정 & 프리셋 (Settings)**:
   - Base URL, API Key, 모델명, 최대 토큰, 추론 모드, **웹검색 사용 여부**, 시스템 프롬프트 설정
   - **연결 테스트(testConnection) 통과 시에만 안전하게 반영**
   - **프리셋 CRUD**: 자주 쓰는 모델 설정(예: `solar-pro4-web`, `qwen-free` 등)을 저장하고 원클릭으로 핫스왑

<br/>

## 🎮 디스코드 내장 명령어 (In-Discord Commands)

| 명령어 | 설명 | 실행 예시 |
| :--- | :--- | :--- |
| `!학습통계` / `!데이터셋` | DB에 누적된 대화 건수, 질문/답변 비율, 통계 카드 출력 | `!학습통계` |
| `!기억 <키워드>` / `!검색` | 과거 대화 및 지식 데이터베이스에서 관련 기록 실시간 검색 | `!기억 날씨` |
| `@답장 <질문>` | 봇과 일반 대화 (실시간 스트리밍 & 발화자 구분 & RAG & 웹검색 적용) | `@답장 오늘 최신 AI 뉴스 요약해줘` |

<br/>

## 🛠️ 환경 변수 설정 (`.env`)

프로젝트 루트의 `.env` 파일에 아래 설정을 입력합니다:

```env
# [필수] 디스코드 봇 토큰
DISCORD_TOKEN=your-discord-bot-token

# [필수] LLM API 키 및 모델명 (OpenRouter / TokenRouter 등)
LLM_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxx
LLM_MODEL=upstage/solar-pro4

# [선택] LLM API 엔드포인트 (기본값: https://api.tokenrouter.com/v1)
LLM_BASE_URL=https://openrouter.ai/api/v1

# [필수] Neon PostgreSQL 데이터베이스 연결 URL
DATABASE_URL=postgresql://user:password@ep-xyz.ap-southeast-1.aws.neon.tech/neondb?sslmode=require

# [선택] 봇 시스템 프롬프트 (성격 및 페르소나)
BOT_SYSTEM_PROMPT=너는 디스코드 대화형 어시스턴트 봇 답장이야. 항상 친절하고 명쾌하게 답변해줘.

# [선택] 최근 대화 문맥 참조 수 (기본값: 20)
MAX_HISTORY_MESSAGES=20

# [선택] 최대 생성 토큰 (기본값: 300)
LLM_MAX_TOKENS=1000

# [선택] 웹 대시보드 포트 (기본값: 3000)
PORT=23006
```

<br/>

## 🚀 빠른 시작 (Quick Start)

```bash
# 1. 패키지 설치
npm install

# 2. 데이터베이스 스키마 마이그레이션 (author_name 컬럼 등 자동 반영)
npm run db:migrate

# 3. 테스트 및 빌드 검증 (72개 테스트 통과)
npm test
npm run typecheck
npm run build

# 4. 봇 & 대시보드 서버 가동
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

디스코드 채널의 과거 대화를 긁어와 Neon DB에 일괄 인제스트합니다 (발화자 이름 자동 색인).

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
│ author_name      │ Text (Nullable) │ 발화자 표시 이름/닉네임│
│ role             │ Enum            │ 'user' | 'assistant'   │
│ content          │ Text            │ 메시지 본문 (원본 보존) │
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
Description=Discord Dapjang Chatbot Service
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

# 실시간 로그 확인
sudo journalctl -u discord-bot -f
```

<br/>

## 🧪 테스트 (Testing)

```bash
# Vitest 단위 테스트 실행 (네트워크 의존성 없는 완전 결정론적 테스트)
npm test

# TypeScript 타입 안전성 검증
npm run typecheck
```

---

<div align="center">
  <sub>Built with ❤️ • Licensed under MIT</sub>
</div>
