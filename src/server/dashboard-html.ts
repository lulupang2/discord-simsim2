export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🐾 답장 (Dapjang) 관리자 대시보드</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main: #0B0F19;
      --bg-card: rgba(18, 24, 38, 0.85);
      --bg-card-hover: rgba(28, 36, 56, 0.9);
      --border: rgba(255, 255, 255, 0.08);
      --border-accent: rgba(99, 102, 241, 0.3);
      --primary: #6366F1;
      --primary-hover: #4F46E5;
      --accent-cyan: #06B6D4;
      --accent-green: #10B981;
      --accent-amber: #F59E0B;
      --accent-rose: #F43F5E;
      --text-main: #F8FAFC;
      --text-muted: #94A3B8;
      --text-dim: #64748B;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
      background: var(--bg-main);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(99, 102, 241, 0.12) 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(6, 182, 212, 0.08) 0%, transparent 40%);
    }

    /* Layout */
    .navbar {
      background: rgba(11, 15, 25, 0.8);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 50;
      padding: 0.85rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-weight: 800;
      font-size: 1.2rem;
      letter-spacing: -0.02em;
    }
    .brand span { color: var(--primary); }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.12);
      color: var(--accent-green);
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent-green);
      box-shadow: 0 0 8px var(--accent-green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    .nav-tabs {
      display: flex;
      gap: 0.5rem;
    }
    .nav-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .nav-btn:hover { color: var(--text-main); background: rgba(255, 255, 255, 0.05); }
    .nav-btn.active {
      color: #fff;
      background: var(--primary);
      box-shadow: 0 2px 10px rgba(99, 102, 241, 0.35);
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
      flex: 1;
      width: 100%;
    }

    /* Cards & Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1.25rem 1.5rem;
      backdrop-filter: blur(12px);
      transition: transform 0.2s, border-color 0.2s;
    }
    .stat-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-accent);
    }
    .stat-label { font-size: 0.8rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 1.8rem; font-weight: 800; margin-top: 0.35rem; color: #fff; font-family: 'JetBrains Mono', monospace; }
    .stat-sub { font-size: 0.75rem; color: var(--text-dim); margin-top: 0.35rem; }

    /* Sections */
    .tab-content { display: none; }
    .tab-content.active { display: block; animation: fadeIn 0.2s ease-in; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1.5rem;
      backdrop-filter: blur(12px);
      margin-bottom: 1.5rem;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      padding-bottom: 0.85rem;
      border-bottom: 1px solid var(--border);
    }
    .card-title { font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-secondary { background: rgba(255, 255, 255, 0.08); color: var(--text-main); }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.14); }
    .btn-danger { background: rgba(248, 81, 73, 0.15); color: #f85149; }
    .btn-danger:hover { background: rgba(248, 81, 73, 0.3); }

    /* Tables & Lists */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    .data-table th {
      text-align: left;
      padding: 0.75rem 1rem;
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid var(--border);
      font-size: 0.78rem;
      text-transform: uppercase;
    }
    .data-table td {
      padding: 0.85rem 1rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      vertical-align: top;
    }
    .data-table tr:hover td { background: var(--bg-card-hover); }

    .role-badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      font-family: 'JetBrains Mono', monospace;
    }
    .role-user { background: rgba(99, 102, 241, 0.18); color: #A5B4FC; border: 1px solid rgba(99, 102, 241, 0.3); }
    .role-assistant { background: rgba(6, 182, 212, 0.18); color: #67E8F9; border: 1px solid rgba(6, 182, 212, 0.3); }
    .level-info { background: rgba(16, 185, 129, 0.15); color: #6EE7B7; }
    .level-warn { background: rgba(245, 158, 11, 0.15); color: #FCD34D; }
    .level-error { background: rgba(244, 63, 94, 0.15); color: #FDA4AF; }

    /* Interactive Chat */
    .chat-box {
      display: flex;
      flex-direction: column;
      height: 480px;
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.25);
    }
    .chat-msg {
      max-width: 80%;
      padding: 0.75rem 1rem;
      border-radius: 12px;
      font-size: 0.92rem;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: var(--primary);
      color: #fff;
      border-bottom-right-radius: 2px;
    }
    .chat-msg.assistant {
      align-self: flex-start;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-main);
      border-bottom-left-radius: 2px;
      border: 1px solid var(--border);
    }
    .chat-input-bar {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .chat-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      color: #fff;
      font-size: 0.92rem;
      outline: none;
    }
    .chat-input:focus { border-color: var(--primary); }

    /* Footer */
    footer {
      text-align: center;
      padding: 1.5rem;
      color: var(--text-dim);
      font-size: 0.8rem;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>

  <nav class="navbar">
    <div class="brand">
      🐾 <span>답장</span> Dapjang Admin
      <div class="status-badge">
        <div class="status-dot"></div> Live Online
      </div>
    </div>
    <div class="nav-tabs">
      <button class="nav-btn active" onclick="switchTab('tab-overview')">대시보드 홈</button>
      <button class="nav-btn" onclick="switchTab('tab-messages')">실시간 대화</button>
      <button class="nav-btn" onclick="switchTab('tab-logs')">시스템 로그</button>
      <button class="nav-btn" onclick="switchTab('tab-playground')">웹 챗 테스터</button>
      <button class="nav-btn" onclick="switchTab('tab-settings')">설정</button>
      <a href="/swagger" target="_blank" class="nav-btn" style="text-decoration:none;">Swagger API ↗</a>
    </div>
  </nav>

  <main class="container">
    <!-- Top Stats Overview -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">총 누적 메시지</div>
        <div class="stat-value" id="stat-total">-</div>
        <div class="stat-sub">Neon DB 저장 완료</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">사용자 질문 / 봇 답변</div>
        <div class="stat-value" id="stat-ratio">- / -</div>
        <div class="stat-sub">실시간 상호작용 세션</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">활성 디스코드 채널</div>
        <div class="stat-value" id="stat-channels">-</div>
        <div class="stat-sub">대화 진행 채널 수</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">LLM 모델 & RAG 엔진</div>
        <div class="stat-value" style="font-size:1.15rem; color:var(--accent-cyan);" id="stat-model">Qwen 3.8 Max</div>
        <div class="stat-sub">TokenRouter • Vector RAG Active</div>
      </div>
    </div>

    <!-- Tab 1: Overview -->
    <div id="tab-overview" class="tab-content active">
      <div class="card">
        <div class="card-header">
          <div class="card-title">📥 파인튜닝 데이터셋 내보내기</div>
          <a href="/api/dataset/export" download="discord-finetuning-dataset.jsonl" class="btn btn-primary">
            JSONL 파일 다운로드
          </a>
        </div>
        <p style="color: var(--text-muted); font-size: 0.9rem; line-height: 1.6;">
          Neon DB에 축적된 사용자 및 봇 대화 기록을 OpenAI / Qwen / Llama 미세조정(Fine-tuning) 표준 규격(ChatML)으로 내보냅니다.
          채널별 문맥을 유지하며 유저의 말투와 지식을 학습시키는 데 최적화되어 있습니다.
        </p>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">💬 최근 실시간 대화 피드</div>
          <button class="btn btn-secondary" onclick="loadMessages()">새로고침</button>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th width="120">일시</th>
              <th width="100">역할</th>
              <th width="140">채널 ID</th>
              <th>메시지 내용</th>
            </tr>
          </thead>
          <tbody id="overview-messages-body">
            <tr><td colspan="4" style="text-align:center; color:var(--text-dim);">로딩 중...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 2: Messages -->
    <div id="tab-messages" class="tab-content">
      <div class="card">
        <div class="card-header">
          <div class="card-title">📚 전체 대화 기록 뷰어</div>
          <div style="display:flex; gap:0.5rem;">
            <input type="text" id="msg-channel-filter" placeholder="채널 ID 필터..." class="chat-input" style="width:180px; padding:0.4rem 0.8rem; font-size:0.85rem;">
            <button class="btn btn-primary" onclick="loadMessages()">조회</button>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th width="160">일시</th>
              <th width="100">역할</th>
              <th width="140">채널 ID</th>
              <th>메시지 본문</th>
            </tr>
          </thead>
          <tbody id="messages-table-body">
            <tr><td colspan="4" style="text-align:center; color:var(--text-dim);">로딩 중...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 3: Logs -->
    <div id="tab-logs" class="tab-content">
      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 실시간 시스템 로그 (Neon bot_logs)</div>
          <div style="display:flex; gap:0.5rem;">
            <select id="log-level-filter" class="chat-input" style="width:120px; padding:0.4rem 0.8rem; font-size:0.85rem;" onchange="loadLogs()">
              <option value="">ALL LEVELS</option>
              <option value="info">INFO</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>
            <button class="btn btn-secondary" onclick="loadLogs()">새로고침</button>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th width="160">시간</th>
              <th width="90">레벨</th>
              <th width="240">메시지</th>
              <th>컨텍스트 (JSON)</th>
            </tr>
          </thead>
          <tbody id="logs-table-body">
            <tr><td colspan="4" style="text-align:center; color:var(--text-dim);">로딩 중...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Tab 4: Playground -->
    <div id="tab-playground" class="tab-content">
      <div class="card">
        <div class="card-header">
          <div class="card-title">🧪 웹 대화형 테스터 (Playground)</div>
          <span style="color:var(--text-dim); font-size:0.8rem;">디스코드 없이 브라우저에서 봇과 실시간 RAG 대화 테스트</span>
        </div>
        <div class="chat-box">
          <div class="chat-messages" id="chat-messages">
            <div class="chat-msg assistant">안녕하세요! 무엇이든 물어보세요. 과거 채널 대화 지식을 바탕으로 답변해 드립니다.</div>
          </div>
          <form class="chat-input-bar" onsubmit="sendTestMessage(event)">
            <input type="text" id="chat-prompt-input" placeholder="질문을 입력하세요..." class="chat-input" autocomplete="off" required>
            <button type="submit" class="btn btn-primary" id="chat-send-btn">전송</button>
          </form>
        </div>
      </div>
    </div>

    <!-- Tab 5: Settings -->
    <div id="tab-settings" class="tab-content">
      <div class="card">
        <div class="card-header">
          <div class="card-title">⚙️ 런타임 설정 (LLM · 페르소나)</div>
          <span style="color:var(--text-dim); font-size:0.8rem;">저장 전 실제 LLM 연결을 테스트하고, 성공 시에만 적용됩니다</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:0.9rem; max-width:720px;">
          <label style="display:flex; flex-direction:column; gap:0.3rem; font-size:0.85rem;">
            Base URL
            <input type="text" id="set-base-url" class="chat-input" placeholder="예: https://openrouter.ai/api/v1">
            <span style="color:var(--text-dim); font-size:0.75rem;">OpenRouter는 <code>https://openrouter.ai/api/v1</code>를 입력해. <code>/chat/completions</code>은 자동 처리됨.</span>
          </label>
          <label style="display:flex; flex-direction:column; gap:0.3rem; font-size:0.85rem;">
            API Key <span id="set-key-masked" style="color:var(--text-dim);"></span>
            <input type="password" id="set-api-key" class="chat-input" placeholder="비워두면 현재 키 유지">
          </label>
          <label style="display:flex; flex-direction:column; gap:0.3rem; font-size:0.85rem;">
            모델명
            <input type="text" id="set-model" class="chat-input" placeholder="예: qwen/qwen3.8-max-free">
          </label>
          <label style="display:flex; flex-direction:column; gap:0.3rem; font-size:0.85rem;">
            최대 응답 토큰 (16~8192)
            <input type="number" id="set-max-tokens" class="chat-input" min="16" max="8192">
          </label>
          <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.85rem; cursor:pointer;">
            <input type="checkbox" id="set-enable-thinking" style="width:16px; height:16px;">
            추론 모드 사용 (reasoning 모델 전용 — 끄면 응답이 빨라짐)
          </label>
          <label style="display:flex; flex-direction:column; gap:0.3rem; font-size:0.85rem;">
            시스템 프롬프트 (말투·페르소나)
            <textarea id="set-system-prompt" class="chat-input" rows="4" placeholder="비워두면 현재 값 유지"></textarea>
          </label>
          <div style="display:flex; align-items:center; gap:0.8rem;">
            <button class="btn btn-primary" onclick="saveSettings(event)">저장 (연결 테스트 후 적용)</button>
            <span id="set-status" style="font-size:0.85rem; color:var(--text-dim);"></span>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:1rem;">
        <div class="card-header">
          <div class="card-title">💾 설정 프리셋</div>
          <span style="color:var(--text-dim); font-size:0.8rem;">폼 값을 이름 붙여 저장하고, 언제든 불러와서 연결 테스트 후 적용할 수 있습니다</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:0.9rem;">
          <div style="display:flex; gap:0.5rem;">
            <input type="text" id="preset-name-input" class="chat-input" placeholder="프리셋 이름 (예: qwen-free)" style="flex:1; max-width:720px;">
            <button class="btn btn-primary" onclick="savePreset(event)">현재 폼 값으로 저장</button>
            <button class="btn btn-secondary" onclick="loadPresets()">새로고침</button>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th width="180">이름</th>
                <th width="220">모델</th>
                <th>Base URL · API Key · 프롬프트</th>
                <th width="270">관리</th>
              </tr>
            </thead>
            <tbody id="preset-table-body">
              <tr><td colspan="4" style="text-align:center; color:var(--text-dim);">저장된 프리셋이 없습니다.</td></tr>
            </tbody>
          </table>
          <span id="preset-status" style="font-size:0.85rem; color:var(--text-dim);"></span>
        </div>
      </div>
    </div>

  </main>

  <footer>
    🐾 Dapjang Admin Dashboard • Powered by ElysiaJS & Neon Database
  </footer>

  <script>
    function switchTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      event.target.classList.add('active');
      if (tabId === 'tab-messages') loadMessages();
      if (tabId === 'tab-logs') loadLogs();
      if (tabId === 'tab-settings') { loadSettings(); loadPresets(); }
    }

    async function loadSettings() {
      try {
        const res = await fetch('/api/settings');
        const s = await res.json();
        document.getElementById('set-base-url').value = s.baseUrl || '';
        document.getElementById('set-model').value = s.model || '';
        document.getElementById('set-max-tokens').value = s.maxTokens || '';
        document.getElementById('set-system-prompt').value = s.systemPrompt || '';
        document.getElementById('set-enable-thinking').checked = Boolean(s.enableThinking);
        document.getElementById('set-status').innerText = s.source === 'file' ? '저장된 설정 사용 중' : '.env 기본값 사용 중';
      } catch (err) {
        console.error('Failed to load settings', err);
      }
    }

    async function saveSettings(e) {
      e.preventDefault();
      const status = document.getElementById('set-status');
      status.innerText = '연결 테스트 중...';
      const payload = collectSettingsForm();
      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          status.innerText = '✅ 저장 및 적용 완료 (' + data.settings.model + ')';
          document.getElementById('set-api-key').value = '';
          loadSettings();
        } else {
          status.innerText = '❌ ' + (data.error || '저장 실패');
        }
      } catch (err) {
        status.innerText = '❌ 요청 실패: ' + err;
      }
    }

    function collectSettingsForm() {
      const payload = {};
      const baseUrl = document.getElementById('set-base-url').value.trim();
      const apiKey = document.getElementById('set-api-key').value.trim();
      const model = document.getElementById('set-model').value.trim();
      const maxTokens = Number(document.getElementById('set-max-tokens').value);
      const systemPrompt = document.getElementById('set-system-prompt').value;
      if (baseUrl) payload.baseUrl = baseUrl;
      if (apiKey) payload.apiKey = apiKey;
      if (model) payload.model = model;
      if (Number.isFinite(maxTokens) && maxTokens > 0) payload.maxTokens = maxTokens;
      if (systemPrompt !== '') payload.systemPrompt = systemPrompt;
      payload.enableThinking = document.getElementById('set-enable-thinking').checked;
      return payload;
    }

    let PRESETS = [];

    async function loadPresets() {
      try {
        const res = await fetch('/api/settings/presets');
        const data = await res.json();
        PRESETS = data.presets || [];
        const body = document.getElementById('preset-table-body');
        if (!PRESETS.length) {
          body.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-dim);">저장된 프리셋이 없습니다.</td></tr>';
          return;
        }
        body.innerHTML = PRESETS.map((p, i) => \`
          <tr>
            <td style="font-weight:600;">\${escapeHtml(p.name)}</td>
            <td style="font-family:'JetBrains Mono'; font-size:0.8rem;">\${escapeHtml(p.model)}</td>
            <td style="color:var(--text-dim); font-size:0.8rem;">\${escapeHtml(p.baseUrl)} · \${escapeHtml(p.apiKeyMasked)}\${p.systemPrompt ? ' · 프롬프트 있음' : ''}</td>
            <td>
              <button class="btn btn-primary" style="padding:0.25rem 0.6rem; font-size:0.75rem;" onclick="applyPreset(\${i})">적용</button>
              <button class="btn btn-secondary" style="padding:0.25rem 0.6rem; font-size:0.75rem;" onclick="fillFormFromPreset(\${i})">불러오기</button>
              <button class="btn btn-danger" style="padding:0.25rem 0.6rem; font-size:0.75rem;" onclick="deletePreset(\${i})">삭제</button>
            </td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Failed to load presets', err);
      }
    }

    async function savePreset(e) {
      e.preventDefault();
      const status = document.getElementById('preset-status');
      const name = document.getElementById('preset-name-input').value.trim();
      if (!name) {
        status.innerText = '❌ 프리셋 이름을 입력하세요.';
        return;
      }
      const payload = collectSettingsForm();
      try {
        const res = await fetch('/api/settings/presets/' + encodeURIComponent(name), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          status.innerText = '✅ 프리셋 저장 완료: ' + data.name + ' (같은 이름이면 기존 내용을 덮어씀)';
          loadPresets();
        } else {
          status.innerText = '❌ ' + (data.error || '프리셋 저장 실패');
        }
      } catch (err) {
        status.innerText = '❌ 요청 실패: ' + err;
      }
    }

    async function applyPreset(i) {
      const preset = PRESETS[i];
      if (!preset) return;
      if (!confirm("'" + preset.name + "' 프리셋을 적용할까요? 연결 테스트 성공 시에만 반영됩니다.")) return;
      const status = document.getElementById('preset-status');
      status.innerText = '연결 테스트 중...';
      try {
        const res = await fetch('/api/settings/presets/' + encodeURIComponent(preset.name) + '/apply', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.ok) {
          status.innerText = '✅ 프리셋 적용 완료 (' + data.settings.model + ')';
          loadSettings();
        } else {
          status.innerText = '❌ ' + (data.error || '프리셋 적용 실패');
        }
      } catch (err) {
        status.innerText = '❌ 요청 실패: ' + err;
      }
    }

    async function fillFormFromPreset(i) {
      const preset = PRESETS[i];
      if (!preset) return;
      document.getElementById('set-base-url').value = preset.baseUrl || '';
      document.getElementById('set-model').value = preset.model || '';
      document.getElementById('set-max-tokens').value = preset.maxTokens || '';
      document.getElementById('set-system-prompt').value = preset.systemPrompt || '';
      document.getElementById('set-enable-thinking').checked = Boolean(preset.enableThinking);
      document.getElementById('preset-name-input').value = preset.name;
      document.getElementById('preset-status').innerText = '프리셋을 폼에 불러왔습니다. 수정 후 같은 이름으로 저장하면 내용이 수정됩니다.';
    }

    async function deletePreset(i) {
      const preset = PRESETS[i];
      if (!preset) return;
      if (!confirm("'" + preset.name + "' 프리셋을 삭제할까요?")) return;
      const status = document.getElementById('preset-status');
      try {
        const res = await fetch('/api/settings/presets/' + encodeURIComponent(preset.name), { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.ok) {
          status.innerText = '🗑️ 삭제 완료: ' + preset.name;
          loadPresets();
        } else {
          status.innerText = '❌ ' + (data.error || '프리셋 삭제 실패');
        }
      } catch (err) {
        status.innerText = '❌ 요청 실패: ' + err;
      }
    }

    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        document.getElementById('stat-total').innerText = data.totalMessages.toLocaleString();
        document.getElementById('stat-ratio').innerText = data.userMessages.toLocaleString() + ' / ' + data.assistantMessages.toLocaleString();
        document.getElementById('stat-channels').innerText = data.channelCount.toLocaleString();
        if (data.model) document.getElementById('stat-model').innerText = data.model;
      } catch (err) {
        console.error('Failed to load stats', err);
      }
    }

    async function loadMessages() {
      try {
        const channel = document.getElementById('msg-channel-filter')?.value || '';
        const url = channel ? '/api/messages?channelId=' + encodeURIComponent(channel) : '/api/messages';
        const res = await fetch(url);
        const data = await res.json();
        
        const renderRows = (items) => {
          if (!items || items.length === 0) return '<tr><td colspan="4" style="text-align:center; color:var(--text-dim);">대화 기록이 없습니다.</td></tr>';
          return items.map(m => \`
            <tr>
              <td style="color:var(--text-dim); font-size:0.8rem; font-family:'JetBrains Mono';">\${new Date(m.createdAt).toLocaleString('ko-KR')}</td>
              <td><span class="role-badge role-\${m.role}">\${m.role}</span></td>
              <td style="font-family:'JetBrains Mono'; font-size:0.8rem; color:var(--accent-cyan);">\${m.channelId}</td>
              <td style="white-space:pre-wrap; word-break:break-all;">\${escapeHtml(m.content)}</td>
            </tr>
          \`).join('');
        };

        const overviewBody = document.getElementById('overview-messages-body');
        if (overviewBody) overviewBody.innerHTML = renderRows(data.items.slice(0, 10));

        const messagesBody = document.getElementById('messages-table-body');
        if (messagesBody) messagesBody.innerHTML = renderRows(data.items);
      } catch (err) {
        console.error('Failed to load messages', err);
      }
    }

    async function loadLogs() {
      try {
        const level = document.getElementById('log-level-filter')?.value || '';
        const url = level ? '/api/logs?level=' + encodeURIComponent(level) : '/api/logs';
        const res = await fetch(url);
        const data = await res.json();
        
        const logsBody = document.getElementById('logs-table-body');
        if (!data.items || data.items.length === 0) {
          logsBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-dim);">로그가 없습니다.</td></tr>';
          return;
        }
        logsBody.innerHTML = data.items.map(l => \`
          <tr>
            <td style="color:var(--text-dim); font-size:0.8rem; font-family:'JetBrains Mono';">\${new Date(l.createdAt).toLocaleString('ko-KR')}</td>
            <td><span class="role-badge level-\${l.level}">\${l.level.toUpperCase()}</span></td>
            <td style="font-weight:600;">\${escapeHtml(l.message)}</td>
            <td><pre style="font-size:0.75rem; color:var(--text-dim); font-family:'JetBrains Mono'; max-height:80px; overflow-y:auto;">\${l.context ? escapeHtml(JSON.stringify(l.context, null, 2)) : '-'}</pre></td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Failed to load logs', err);
      }
    }

    async function sendTestMessage(e) {
      e.preventDefault();
      const input = document.getElementById('chat-prompt-input');
      const text = input.value.trim();
      if (!text) return;

      const chatMessages = document.getElementById('chat-messages');
      chatMessages.innerHTML += \`<div class="chat-msg user">\${escapeHtml(text)}</div>\`;
      input.value = '';
      chatMessages.scrollTop = chatMessages.scrollHeight;

      const loadingMsg = document.createElement('div');
      loadingMsg.className = 'chat-msg assistant';
      loadingMsg.innerText = '답변 생성 중...';
      chatMessages.appendChild(loadingMsg);
      chatMessages.scrollTop = chatMessages.scrollHeight;

      try {
        const res = await fetch('/api/test-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: text }),
        });
        const data = await res.json();
        loadingMsg.innerText = data.reply || '답변을 불러오지 못했습니다.';
      } catch (err) {
        loadingMsg.innerText = '오류 발생: ' + err.message;
      }
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // Auto-init & polling
    loadStats();
    loadMessages();
    setInterval(loadStats, 15000);
  </script>
</body>
</html>`;
}
