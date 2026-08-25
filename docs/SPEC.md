# Functional & Technical Specification (SPEC)

---

## 1. 개요 및 요구사항 정의

본 문서는 Discord 대화형 AI 봇 **답장 (Dapjang)**의 기능적 동작 방식과 내부 구현 명세를 상세히 기술한다.

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
     │     본인 멘션이 있으면 제거
     │     - 텍스트 존재: 해당 텍스트 반환
     │     - 텍스트 공백 & 이미지 첨부파일 존재: "이 이미지에 대해 설명해줘." 반환
     │     - 텍스트 공백 & 첨부파일 없음: 무시 (Ignored)
     │
     └─► 서버(길드) 채널인 경우:
           본인 멘션(<@봇ID> 또는 <@!봇ID>)이 포함되어 있는지 검사
           - 미포함: 무시 (Ignored)
           - 포함: 본인 멘션 제거 후 문자열 트리밍
           - 텍스트 존재: 해당 텍스트 반환
           - 텍스트 공백 & 이미지 첨부파일 존재: "이 이미지에 대해 설명해줘." 반환
           - 텍스트 공백 & 첨부파일 없음: 무시 (Ignored)
```

---

## 3. LLM 통신 & OpenAI 호환 명세 (`src/llm.ts`)

### 3.1. 엔드포인트 및 프로토콜
- **URL**: `{LLM_BASE_URL}/chat/completions` (기본값: `https://api.tokenrouter.com/v1/chat/completions` 또는 `https://openrouter.ai/api/v1/chat/completions`)
- **Method**: `POST`
- **Headers**:
  - `authorization: Bearer <LLM_API_KEY>`
  - `content-type: application/json`

### 3.2. 요청 Body 명세 (멀티모달 및 웹검색 포함)
```json
{
  "model": "upstage/solar-pro4",
  "messages": [
    { "role": "system", "content": "시스템 페르소나 지침\n\n[참고] ..." },
    { "role": "user", "content": "철수: 이전 질문" },
    { "role": "assistant", "content": "이전 답변" },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "영희: 이 사진 뭐야?" },
        { "type": "image_url", "image_url": { "url": "https://cdn.discordapp.com/attachments/..." } }
      ]
    }
  ],
  "max_tokens": 1000,
  "tools": [
    {
      "type": "openrouter:web_search",
      "parameters": {
        "engine": "auto",
        "max_results": 3,
        "max_uses": 1,
        "search_context_size": "low"
      }
    }
  ]
}
```

### 3.3. 응답 파싱 및 출처 첨부 규칙
- **텍스트 추출 우선순위**:
  1. `choices[0].message.content` (일반 텍스트)
  2. `choices[0].message.reasoning_content` 또는 `reasoning` (추론 모델 폴백)
  3. `choices[0].message.refusal` (거부 메시지)
  4. `choices[0].finish_reason === "length"` → 최대 토큰 초과 안내 반환
- **웹검색 출처 (Annotations)**:
  - `choices[0].message.annotations` 배열에서 `type: "url_citation"` 객체를 파싱.
  - 유효한 HTTP/HTTPS URL을 최대 5개 추출하여 응답 본문 하단에 `출처:\n- [제목](URL)` 형태로 자동 첨부.

---

## 4. 다자간 발화자 인지 & 채팅 스타일 분석 (`src/conversation.ts`, `src/chat-style.ts`)

### 4.1. 발화자 인지 (Speaker Attribution)
- 메시지 수신 시 `message.member?.displayName ?? message.author.globalName ?? message.author.username`으로 발화자 명칭을 결정.
- LLM에 전송 시 모든 유저 턴에 `이름: 내용` 접두사를 붙여 모델이 다자간 대화 맥락을 인지하도록 유도.
- DB에는 원본 텍스트만 저장하고 `author_name` 컬럼에 닉네임을 별도 보관하여 파인튜닝 데이터셋 오염 방지.

### 4.2. 사용자 채팅 스타일 자동 분석 (Chat Style Profiling)
- 해당 사용자의 최근 발화 최대 100건(최소 3건)을 가져와 규칙 기반으로 분석:
  - **말투**: `~습니다`/`~해요` vs `~야`/`~함`/`~ㅋㅋ` 비율 계산 (반말 / 존댓말 / 혼용 / 중립)
  - **문장 길이**: 평균 글자 수 (짧음 ≤20, 보통 ≤80, 김 >80)
  - **패턴 비율**: 질문(`?`), 느낌표(`!`), 이모지 포함 비율(%)
  - **추임새/밈**: 2회 이상 등장한 빈출 표현(`ㅋㅋ`, `ㅎㅎ`, `ㅇㅇ`, `ㅠㅠ` 등)
- 분석 결과를 시스템 프롬프트 하단에 `[현재 사용자 채팅 스타일 참고]` 블록으로 주입.

---

## 5. 실시간 메시지 스트리밍 버퍼 명세 (`src/stream-writer.ts`)

1. **초기 메시지 전송 (`sendInitial`)**:
   - 첫 번째 유효한 텍스트 델타가 도착하면 Discord에 첫 번째 메시지를 전송하고 핸들을 획득.
2. **라이브 수정 (`edit`)**:
   - 이후 도착하는 델타는 메모리 버퍼에 누적하며, 최소 **800ms 간격**으로 디스코드 메시지를 라이브 업데이트.
3. **2,000자 초과 처리**:
   - Discord의 2,000자 제한을 초과하는 긴 응답은 첫 번째 메시지를 2,000자에서 완성한 뒤, 다음 2,000자 단위 청크들을 순차적으로 후속 메시지(`sendFinalChunk`)로 전송.
4. **완료 (`finish`)**:
   - 스트림이 종료되면 마지막 누적 텍스트를 메시지에 최종 반영하고 완료.

---

## 6. 관리자 웹 대시보드 API 명세 (`src/server/`)

- `GET /` & `GET /admin`: 실시간 반응형 관리자 웹 대시보드 HTML 반환
- `GET /health`: 봇 가동 상태 및 업타임 반환
- `GET /api/stats`: 총 메시지, 질문/답변 비율, 참여 채널 수, 활성 모델 통계
- `GET /api/messages`: 전체 대화 기록 페이징 및 채널 ID 필터 조회
- `GET /api/user-styles`: 사용자별 채팅 스타일 분석 결과 집계표 조회
- `GET /api/logs`: 시스템 로그 조회 (레벨 필터링 지원)
- `GET /api/dataset/export`: OpenAI/Qwen/Llama 파인튜닝용 ChatML `JSONL` 파일 다운로드
- `POST /api/test-chat`: 대시보드 내 실시간 RAG 대화형 테스터
- `GET /api/settings`: 현재 활성 런타임 설정 반환 (API 키 마스킹)
- `PUT /api/settings`: 런타임 설정 연결 테스트 후 즉시 반영 및 저장
- `GET /api/settings/presets`: 저장된 설정 프리셋 목록 조회
- `PUT /api/settings/presets/:name`: 설정 프리셋 추가 및 수정
- `POST /api/settings/presets/:name/apply`: 프리셋 연결 테스트 후 봇에 즉시 적용
- `DELETE /api/settings/presets/:name`: 설정 프리셋 삭제

---

## 7. 오류 복구 및 재시도 계약

| 시나리오 | 동작 명세 |
|---|---|
| **설정 누락/오류** | 시작 시 누락된 모든 환경변수 이름을 나열하고 `exit 1`로 즉시 종료. |
| **Neon DB 접속 불가** | 부팅 시 `ping()` 실패 시 즉시 종료 (systemd가 자동 재시작). |
| **타이핑 표시 실패** | 경고 로그 기록 후 대화 생성 및 응답은 계속 진행. |
| **대화 내역 조회 실패** | LLM 호출을 건너뛰고 사용자에게 `"Sorry, I couldn't generate a response right now. Please try again."` 전송. |
| **LLM API 호출 실패** | 에러 로그 기록 후 사용자에게 실패 안내 메시지 전송. DB에 실패한 대화는 커밋하지 않음. |
| **빈 텍스트 응답** | 추론/거부/토큰초과 폴백 탐색 후, 출처가 있으면 출처 목록을 반환하여 에러 방지. |
| **Discord 응답 전송 실패** | 전송 실패 로그 기록 후 DB 커밋 취소. |
| **DB 대화 커밋 실패** | Discord 답변은 이미 전달되었으므로 로그만 기록하고 정상 종료. |
