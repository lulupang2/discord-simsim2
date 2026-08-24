# Operations & Runbook Guide (OPERATIONS)

---

## 1. 운영 환경 개요

- **호스트**: Rocky Linux 10.2 (IP: `45.151.152.179`)
- **서비스명**: `discord-bot.service`
- **프로세스 관리**: `systemd` (자동 재시작: `Restart=always`, `RestartSec=5`)
- **실행 사용자**: `work:work`
- **배포 경로**: `/home/work/discord-bot`
- **환경 파일**: `/home/work/discord-bot/.env` (권한 `600`)

---

## 2. 일상 운영 명령어 (Daily Cheatsheet)

### 2.1. 서비스 제어
```bash
# 상태 확인
sudo systemctl status discord-bot

# 서비스 재시작 (설정 변경 후 적용)
sudo systemctl restart discord-bot

# 서비스 시작 / 중지
sudo systemctl start discord-bot
sudo systemctl stop discord-bot
```

### 2.2. 로그 모니터링
```bash
# 실시간 스트리밍 로그 보기 (가장 많이 사용)
sudo journalctl -u discord-bot -f

# 최근 50줄 출력
sudo journalctl -u discord-bot -n 50 --no-pager

# 오늘 발생한 에러만 보기
sudo journalctl -u discord-bot -p err --since today --no-pager
```

---

## 3. 트러블슈팅 가이드 (Troubleshooting)

### 3.1. `Discord login failed` 오류
- **원인 1**: `DISCORD_TOKEN` 값이 잘못되었거나 Client Secret을 넣은 경우.
  - 해결: Discord Developer Portal에서 70자 이상의 Bot Token을 복사해 넣는다.
- **원인 2**: `Message Content Intent`가 꺼져 있는 경우.
  - 해결: Discord Developer Portal -> Bot -> Privileged Gateway Intents -> Message Content Intent를 활성화한다.

### 3.2. `Neon database connection failed` 오류
- **원인 1**: `DATABASE_URL` 형식이 잘못되었거나 비밀번호가 틀린 경우.
  - 해결: `postgresql://user:password@host/neondb?sslmode=require` 형식을 확인한다.
- **원인 2**: Neon 프로젝트가 일시 중지(Compute suspended)되었거나 네트워크가 차단된 경우.
  - 해결: Neon 콘솔에서 인스턴스 활성 상태를 확인하고 `sslmode=require` 파라미터가 포함되어 있는지 점검한다.

### 3.3. `Gemini stream completion failed` 오류
- **원인 1**: `LLM_API_KEY`가 유효하지 않거나 만료된 경우.
  - 해결: Google AI Studio에서 새 API 키를 발급받아 교체한다.
- **원인 2**: 할당량(Quota) 초과 또는 429 Rate Limit.
  - 해결: AI Studio 콘솔에서 사용량 및 결제 계정 한도를 확인한다.

### 3.4. 봇이 서버 채팅에 무반응인 경우
- **체크 1**: 봇에게 `@안내견` 멘션을 포함해서 말했는지 확인 (멘션 없는 일반 채팅은 의도적으로 무시됨).
- **체크 2**: 1:1 개인 DM을 열어서 멘션 없이 말 걸어본다.
- **체크 3**: 봇의 채널 권한(메시지 읽기, 메시지 보내기, 메시지 기록 보기)이 부여되었는지 확인.
