# Functional & Technical Specification (SPEC)

---

## 1. 개요 및 요구사항 정의

본 문서는 Discord 대화형 AI 봇의 기능적 동작 방식과 내부 구현 명세를 상세히 기술한다.

---

## 2. Discord Gateway & 입력 처리 명세

### 2.1. 인텐트(Intents) 및 파셜(Partials)
- **필수 게이트웨이 인텐트**:
  - `GatewayIntentBits.Guilds`
  - `GatewayIntentBits.GuildMessages`
  - `GatewayIntentBits.DirectMessages`
  - `GatewayIntentBits.MessageContent` (특권 인텐트 - Discord Developer Portal에서 활성화 필수)
- **파셜 설정**:
  - `Partials.Channel` (DM 채널의 메시지 수신 처리를 위해 필수)

### 2.2. 메시지 필터링 및 프롬프트 추출 (`src/trigger.ts`)
```text
[메시지 수신]
     │
     ├─► author.bot === true  ───► 무시 (Ignored)
     ├─► webhookId !== null   ───► 무시 (Ignored)
     │
     ├─► DM 채널인 경우:
     │     본인 멘션이 있으면 제거, 없으면 전체 내용 트리밍 후 추출
     │
     └─► 서버(길드) 채널인 경우:
           본인 멘션(<@봇ID> 또는 <@!봇ID>)이 포함되어 있는지 검사
           - 미포함: 무시 (Ignored)
           - 포함: 본인 멘션만 정확히 치환 제거한 뒤 나머지 문자열 트리밍
           - 치환 후 문자열 길이가 0이면 무시 (Ignored)
```

---

## 3. Gemini Interactions API 스트리밍 명세 (`src/llm.ts`)

### 3.1. 엔드포인트 및 프로토콜
- **URL**: `https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse`
- **Method**: `POST`
- **Headers**:
  - `x-goog-api-key: <LLM_API_KEY>`
  - `content-type: application/json`

### 3.2. 요청 Body 명세
```json
{
  "model": "gemini-3.7-flash",
  "input": [
    { "role": "user", "parts": [{ "text": "과거 질문" }] },
    { "role": "model", "parts": [{ "text": "과거 답변" }] },
    { "role": "user", "parts": [{ "text": "현재 질문" }] }
  ],
  "system_instruction": "시스템 페르소나 지침",
  "generation_config": {
    "thinking_level": "low"
  },
  "stream": true,
  "store": false
}
```

### 3.3. SSE 스트림 파싱 규칙
- `event: step.delta` 및 `data: {"event_type":"step.delta","delta":{"type":"text","text":"..."}}` 이벤트 블록을 추출.
- `delta.type === "text"`인 경우에만 텍스트 조각(`delta.text`)을 누적하고 콜백(`onDelta`)으로 전달.
- `step.start`, `step.stop`, `thought`, `interaction.created`, `interaction.completed` 등의 메타데이터 이벤트는 디스코드 출력 버퍼에서 무시.
- `data: [DONE]` 또는 스트림 종료 시 결합된 전체 응답 문자열을 반환.
- `error` 이벤트 수신 시 `LlmProviderError`를 즉시 발생시켜 오류 경로로 전환.

---

## 4. 실시간 메시지 스트리밍 버퍼 명세 (`src/stream-writer.ts`)

Discord의 엄격한 메시지 수정 Rate Limit(채널당 초당 1~5회)을 고려하여 다음과 같은 디바운스/버퍼링 전략을 적용한다.

1. **초기 메시지 전송 (`sendInitial`)**:
   - 첫 번째 유효한 텍스트 델타가 도착하면 Discord에 첫 번째 메시지를 전송하고 핸들을 획득한다.
2. **라이브 수정 (`edit`)**:
   - 이후 도착하는 델타는 메모리 버퍼에 누적하며, 최소 **800ms 간격**으로 디스코드 메시지를 업데이트한다.
3. **2,000자 초과 처리**:
   - Discord의 2,000자 제한을 초과하는 긴 응답은 첫 번째 메시지를 2,000자에서 완성한 뒤, 다음 2,000자 단위 청크들을 순차적으로 후속 메시지(`sendFinalChunk`)로 전송한다.
4. **완료 (`finish`)**:
   - 스트림이 종료되면 마지막 누적 텍스트를 메시지에 최종 반영하고 완료한다.

---

## 5. 데이터베이스 저장 및 격리 명세 (`src/db/`)

### 5.1. 대화 저장소 (`NeonConversationStore`)
- **조회 (`getRecent`)**:
  ```sql
  SELECT role, content FROM messages
  WHERE channel_id = :channelId
  ORDER BY created_at DESC, id DESC
  LIMIT :maxHistoryMessages;
  ```
  가져온 역순 배열을 다시 `reverse()`하여 과거부터 현재 순서로 LLM `messages`에 전달.
- **저장 (`appendExchange`)**:
  ```sql
  INSERT INTO messages (channel_id, guild_id, author_id, role, content)
  VALUES 
    (:channelId, :guildId, :userId, 'user', :userMessage),
    (:channelId, :guildId, :botUserId, 'assistant', :assistantMessage);
  ```

### 5.2. 비동기 로그 싱크 (`NeonLogSink`)
- `logger.info`, `logger.warn`, `logger.error` 발생 시 콘솔 출력 즉시 실행.
- 백그라운드 비동기로 `bot_logs` 테이블에 INSERT 수행.
- INSERT 도중 네트워크 에러가 발생해도 봇 프로세스가 종료되지 않도록 `catch` 블록에서 격리.

---

## 6. 오류 복구 및 재시도 계약

| 시나리오 | 동작 명세 |
|---|---|
| **설정 누락/오류** | 시작 시 누락된 모든 환경변수 이름을 나열하고 `exit 1`로 즉시 종료. |
| **Neon DB 접속 불가** | 부팅 시 `ping()` 실패 시 즉시 종료 (systemd가 자동 재시작). |
| **타이핑 표시 실패** | 경고 로그 기록 후 대화 생성 및 응답은 계속 진행. |
| **대화 내역 조회 실패** | LLM 호출을 건너뛰고 사용자에게 `"Sorry, I couldn't generate a response right now. Please try again."` 전송. |
| **Gemini API 호출 실패** | 에러 로그 기록 후 사용자에게 실패 안내 메시지 전송. DB에 실패한 대화는 커밋하지 않음. |
| **Discord 응답 전송 실패** | 전송 실패 로그 기록 후 DB 커밋 취소. 사용자에게 실패 안내 메시지 전송 시도. |
| **DB 대화 커밋 실패** | Discord 답변은 이미 전달되었으므로 로그만 기록하고 정상 종료. |
