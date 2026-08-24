# Project Plan & Operations Roadmap (PLAN)

---

## 1. 구현 단계별 진행 내역 (Changelog)

### Phase 1: 기반 아키텍처 & 다중 에이전트 비교 평가 (완료)
- [x] Orca 오케스트레이션 기반 독립 작업트리 분기 (`benchmark-*`)
- [x] 동일 베이스(`5a1e68c`)에서 Codex, OMP, Hermes, OpenCode 4개 워커 경쟁 구현
- [x] `gpt-5.6-sol max` 통일 모델 기준으로 전면 재검증 및 품질 평가
- [x] **OMP 구현체 최종 선정** 및 메인 브랜치 승격 (`feat: add Discord LLM chatbot MVP`)

### Phase 2: Rocky Linux 원격 배포 및 초기 가동 (완료)
- [x] Rocky Linux 10.2 (`45.151.152.179`) 환경 설정 (Node.js 22, Git, npm)
- [x] `/home/work/discord-bot` 디렉터리에 배포 및 권한 설정 (`work:work`)
- [x] `discord-bot.service` systemd 유닛 등록 및 24시간 자동 재시작 구성
- [x] Discord Token / Qwen 3.8 연동 및 온라인 확인 (`안내견#3860`)

### Phase 3: Neon PostgreSQL 영속화 & Gemini Interactions API 스트리밍 전환 (완료)
- [x] Drizzle ORM 및 `@neondatabase/serverless` 기반 스키마 설계 (`messages`, `bot_logs`)
- [x] 마이그레이션 SQL 생성 (`drizzle/0000_flawless_joshua_kane.sql`)
- [x] Google Gemini Interactions API (`gemini-3.7-flash`) SSE 실시간 스트리밍 클라이언트 구현
- [x] 800ms 디바운스 실시간 메시지 수정 버퍼 (`LiveStreamWriter`) 구현
- [x] 7개 테스트 파일 37개 단위 테스트 전체 통과 (100% 무네트워크 결정론적 테스트)

---

## 2. 서버 배포 및 마이그레이션 런북

### 2.1. 사전 준비 (Prerequisites)
1. **Neon PostgreSQL 프로젝트 생성**:
   - [Neon Console](https://console.neon.tech)에서 데이터베이스 생성 후 접속 URL 획득 (`DATABASE_URL`).
2. **Google Gemini API Key 발급**:
   - [Google AI Studio](https://aistudio.google.com/apikey)에서 API 키 획득 (`LLM_API_KEY`).

### 2.2. 서버 배포 절차 (Blue-Green 디렉터리 스왑)
```bash
# 1. 새 버전 클론
cd /home/work
git clone https://github.com/lulupang2/discord-simsim2.git discord-bot-next

# 2. 환경변수 설정
cp /home/work/discord-bot/.env /home/work/discord-bot-next/.env
nano /home/work/discord-bot-next/.env
# DATABASE_URL=postgresql://user:password@ep-xyz.neon.tech/neondb?sslmode=require
# LLM_API_KEY=AIzaSy...
# LLM_MODEL=gemini-3.7-flash

# 3. 의존성 설치 및 DB 마이그레이션
cd /home/work/discord-bot-next
npm ci
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' .env)" npm run db:migrate

# 4. 검증 및 빌드
npm test
npm run typecheck
npm run build

# 5. 무중단 디렉터리 교체 및 서비스 재시작
cd /home/work
sudo systemctl stop discord-bot
mv discord-bot "discord-bot.previous-$(date +%Y%m%d%H%M%S)"
mv discord-bot-next discord-bot
sudo systemctl start discord-bot

# 6. 상태 및 로그 확인
sudo systemctl status discord-bot --no-pager
sudo journalctl -u discord-bot -f
```

---

## 3. 향후 고도화 로드맵 (Future Improvements)

1. **대화 요약 압축 (Context Summarization)**:
   - 대화가 50개 이상 누적된 장기 채널의 경우, 과거 대화를 주기적으로 1~2줄 요약본으로 축약하여 LLM에 추가 제공.
2. **Discord 슬래시 명령어 (Slash Commands) 지원**:
   - `/reset`: 현재 채널의 이전 대화 맥락 초기화
   - `/persona`: 사용자별/서버별 시스템 프롬프트 실시간 전환
   - `/usage`: 당일 토큰 사용량 및 통계 조회
3. **간이 헬스체크 HTTP 엔드포인트 (`node:http`)**:
   - 배포 인프라 및 모니터링 툴(Uptime Kuma, BetterStack 등)을 위한 경량 `/health` 포트 오픈.
4. **이미지/첨부파일 멀티모달 지원**:
   - 디스코드에 업로드된 이미지를 Gemini Interactions API의 `image` 파트로 전달하여 시각 분석 기능 제공.
