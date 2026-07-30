document.addEventListener("DOMContentLoaded", function () {
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // --- Active nav link highlighting ---
  (function highlightActiveNavLink() {
    var navLinks = document.querySelectorAll(".nav-links a");
    if (!navLinks.length) return;

    var currentPage = window.location.pathname.split("/").pop();
    if (currentPage === "") currentPage = "index.html";

    navLinks.forEach(function (link) {
      var linkPage = link.getAttribute("href").split("/").pop();
      if (linkPage === currentPage) {
        link.classList.add("is-active");
      } else {
        link.classList.remove("is-active");
      }
    });
  })();

// --- four screening classes (about.html) --- 

  // --- Consent modal (screening.html) ---
  var consentTrigger = document.querySelector("[data-open-consent]");
  var overlay = document.querySelector(".modal-overlay");
  var stepIndicator = document.querySelector("[data-step-indicator]");

  function setScreeningStep(stepName) {
    if (!stepIndicator) return;
    var order = ["consent", "capture", "result"];
    var currentIndex = order.indexOf(stepName);
    stepIndicator.querySelectorAll(".step").forEach(function (stepEl) {
      var stepOrderIndex = order.indexOf(stepEl.getAttribute("data-step"));
      stepEl.classList.remove("is-active", "is-done");
      if (stepOrderIndex < currentIndex) stepEl.classList.add("is-done");
      else if (stepOrderIndex === currentIndex) stepEl.classList.add("is-active");
    });
  }

  if (consentTrigger && overlay) {
    var checkbox = overlay.querySelector('input[type="checkbox"]');
    var proceedBtn = overlay.querySelector("[data-consent-proceed]");
    var declineBtn = overlay.querySelector("[data-consent-decline]");
    var screeningPanel = document.querySelector("[data-screening-panel]");

    function openModal() {
      overlay.classList.add("is-open");
      if (checkbox) checkbox.checked = false;
      if (proceedBtn) proceedBtn.setAttribute("disabled", "true");
    }
    function closeModal() { overlay.classList.remove("is-open"); }

    consentTrigger.addEventListener("click", openModal);
    if (declineBtn) declineBtn.addEventListener("click", closeModal);
    if (checkbox && proceedBtn) {
      checkbox.addEventListener("change", function () {
        if (checkbox.checked) proceedBtn.removeAttribute("disabled");
        else proceedBtn.setAttribute("disabled", "true");
      });
    }
    if (proceedBtn) {
      proceedBtn.addEventListener("click", function () {
        if (proceedBtn.hasAttribute("disabled")) return;
        closeModal();
        if (screeningPanel) {
          screeningPanel.classList.add("is-unlocked");
          var statusEl = screeningPanel.querySelector("[data-status]");
          if (statusEl) statusEl.textContent = "Status: consent granted — ready to capture";
          var recordBtn = screeningPanel.querySelector("[data-record-btn]");
          if (recordBtn) recordBtn.removeAttribute("disabled");
          var micStatus = screeningPanel.querySelector("[data-mic-status]");
          if (micStatus) micStatus.textContent = "Ready. Recordings are not sent anywhere in this demo build.";
          var uploadInput = screeningPanel.querySelector("[data-upload-input]");
          if (uploadInput) uploadInput.removeAttribute("disabled");
          var uploadStatus = screeningPanel.querySelector("[data-upload-status]");
          if (uploadStatus) uploadStatus.textContent = "Ready. Choose a .wav file to continue.";
        }
        consentTrigger.setAttribute("disabled", "true");
        consentTrigger.textContent = "Consent Granted";
        setScreeningStep("capture");
      });
    }
  }

  // --- Capture method tabs (screening.html) ---
  var tabs = document.querySelectorAll(".capture-tab");
  if (tabs.length) {
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");
        document.querySelectorAll("[data-capture-panel]").forEach(function (p) {
          p.style.display = p.getAttribute("data-capture-panel") === tab.getAttribute("data-tab") ? "block" : "none";
        });
      });
    });
  }

  // --- Browser microphone recording (screening.html) ---
  var recordBtn = document.querySelector("[data-record-btn]");
  var micStatus = document.querySelector("[data-mic-status]");
  var micPlayback = document.querySelector("[data-mic-playback]");
  var runScreeningBtn = document.querySelector("[data-run-screening]");
  var recordedBlob = null;

  // Converts a decoded AudioBuffer into a real, standard 16-bit PCM WAV file.
  // Needed because MediaRecorder outputs WebM/Opus, which the backend's
  // audio pipeline (torchaudio + soundfile) cannot open directly.
  function audioBufferToWavBlob(audioBuffer) {
    var numSamples = audioBuffer.length;
    var sampleRate = audioBuffer.sampleRate;

    var channelData;
    if (audioBuffer.numberOfChannels > 1) {
      var ch0 = audioBuffer.getChannelData(0);
      var ch1 = audioBuffer.getChannelData(1);
      channelData = new Float32Array(numSamples);
      for (var i = 0; i < numSamples; i++) channelData[i] = (ch0[i] + ch1[i]) / 2;
    } else {
      channelData = audioBuffer.getChannelData(0);
    }

    var bytesPerSample = 2;
    var blockAlign = bytesPerSample;
    var byteRate = sampleRate * blockAlign;
    var dataSize = numSamples * blockAlign;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);

    function writeString(offset, str) {
      for (var j = 0; j < str.length; j++) view.setUint8(offset + j, str.charCodeAt(j));
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    var offset = 44;
    for (var k = 0; k < numSamples; k++) {
      var sample = Math.max(-1, Math.min(1, channelData[k]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, sample, true);
      offset += 2;
    }

    return new Blob([view], { type: "audio/wav" });
  }

  if (recordBtn) {
    var mediaRecorder = null;
    var audioChunks = [];
    var isRecording = false;

    recordBtn.addEventListener("click", function () {
      if (recordBtn.hasAttribute("disabled")) return;

      if (!isRecording) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          if (micStatus) micStatus.textContent = "This browser doesn't support microphone recording.";
          return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(function (stream) {
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.addEventListener("dataavailable", function (e) {
              if (e.data.size > 0) audioChunks.push(e.data);
            });
            mediaRecorder.addEventListener("stop", function () {
              stream.getTracks().forEach(function (t) { t.stop(); });
              var rawBlob = new Blob(audioChunks, { type: "audio/webm" });

              if (micStatus) micStatus.textContent = "Processing recording...";
              if (runScreeningBtn) runScreeningBtn.setAttribute("disabled", "true");

              rawBlob.arrayBuffer()
                .then(function (arrayBuffer) {
                  var AudioContextClass = window.AudioContext || window.webkitAudioContext;
                  var audioCtx = new AudioContextClass();
                  return audioCtx.decodeAudioData(arrayBuffer);
                })
                .then(function (audioBuffer) {
                  recordedBlob = audioBufferToWavBlob(audioBuffer);
                  var url = URL.createObjectURL(recordedBlob);
                  if (micPlayback) {
                    micPlayback.src = url;
                    micPlayback.style.display = "block";
                  }
                  if (micStatus) micStatus.textContent = "Recording captured. Review it below, or record again.";
                  if (runScreeningBtn) runScreeningBtn.removeAttribute("disabled");
                })
                .catch(function () {
                  if (micStatus) micStatus.textContent = "Could not process the recording. Please try again.";
                });
            });
            mediaRecorder.start();
            isRecording = true;
            recordBtn.textContent = "Stop Recording";
            if (micStatus) micStatus.textContent = "Recording... cough once, then stop.";
          })
          .catch(function () {
            if (micStatus) micStatus.textContent = "Microphone access was denied or unavailable.";
          });
      } else {
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
        isRecording = false;
        recordBtn.textContent = "Start Recording";
      }
    });
  }

  // --- WAV upload validation (screening.html) ---
  var uploadInput = document.querySelector("[data-upload-input]");
  var uploadStatus = document.querySelector("[data-upload-status]");
  if (uploadInput) {
    uploadInput.addEventListener("change", function () {
      var file = uploadInput.files && uploadInput.files[0];
      if (!file) return;
      var isWav = file.type === "audio/wav" || file.type === "audio/x-wav" || /\.wav$/i.test(file.name);
      if (!isWav) {
        if (uploadStatus) uploadStatus.textContent = file.name + " isn't a .wav file. Please choose a WAV recording.";
        uploadInput.value = "";
        return;
      }
      var sizeKb = Math.round(file.size / 1024);
      if (uploadStatus) uploadStatus.textContent = file.name + " (" + sizeKb + " KB) selected.";
      if (runScreeningBtn) runScreeningBtn.removeAttribute("disabled");
    });
  }

  // --- Backend connection ---
  // Your Flask server must be running (python app.py) for these to work.
  const API_BASE = "http://127.0.0.1:5000";

  // --- Screening results: save via the real backend (screening.html) ---
  // Note: there is no public "view all history" here anymore — that's
  // intentionally restricted to logged-in clinicians on dashboard.html,
  // since screening results are patient data.
  var resultPanel = document.querySelector("[data-result-panel]");

  if (runScreeningBtn && resultPanel) {
    runScreeningBtn.addEventListener("click", function () {
      var activeTab = document.querySelector(".capture-tab.is-active");
      var tabName = activeTab ? activeTab.getAttribute("data-tab") : "mic";

      var audioBlob = null;
      if (tabName === "mic") {
        audioBlob = recordedBlob;
      } else if (tabName === "upload") {
        audioBlob = uploadInput && uploadInput.files && uploadInput.files[0];
      }

      if (!audioBlob) {
        setScreeningStep("result");
        resultPanel.style.display = "block";
        resultPanel.innerHTML = '<div class="notice"><h3>No Audio Yet</h3><p style="font-size:0.85rem;">Record a cough or choose a WAV file before running a screening. The ESP32-S3 device path isn\'t connected in this build.</p></div>';
        return;
      }

      runScreeningBtn.setAttribute("disabled", "true");
      runScreeningBtn.textContent = "Analyzing...";

      var formData = new FormData();
      var filename = tabName === "mic" ? "recording.wav" : (audioBlob.name || "upload.wav");
      formData.append("file", audioBlob, filename);
      formData.append("patient_label", "Web Portal Screening — " + new Date().toLocaleString());

      fetch(API_BASE + "/api/screenings/predict", {
        method: "POST",
        body: formData
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          setScreeningStep("result");
          resultPanel.style.display = "block";

          if (!result.ok) {
            resultPanel.innerHTML = '<div class="notice"><h3>Screening Failed</h3><p style="font-size:0.85rem;">' + (result.data.error || "The backend could not process this audio.") + '</p></div>';
            return;
          }

          var data = result.data;
          var distributionRows = "";
          if (data.distribution) {
            distributionRows = Object.keys(data.distribution).map(function (className) {
              return '<tr><td>' + className + '</td><td>' + data.distribution[className] + '%</td></tr>';
            }).join('');
          }

          resultPanel.innerHTML =
            '<div class="notice">' +
            '<h3>Screening Result</h3>' +
            '<table style="margin-top:10px;">' +
            '<tr><th>Tier</th><th>Output</th></tr>' +
            '<tr><td>1 — TB Gatekeeper</td><td>' + data.tb_status + ' (' + data.tb_confidence + '% confidence)</td></tr>' +
            (data.tier_reached === 1 || data.distribution === null
              ? '<tr><td colspan="2">Screening halted at Tier 1 per gated protocol — TB-positive acoustic markers detected.</td></tr>'
              : '<tr><td>2 — Respiratory Classifier</td><td>' + data.prediction + ' (' + data.confidence + '% confidence)</td></tr>'
            ) +
            '</table>' +
            (distributionRows
              ? '<table style="margin-top:10px;"><tr><th colspan="2">Full Probability Distribution</th></tr>' + distributionRows + '</table>'
              : '') +
            (data.recommendation
              ? '<div class="box" style="margin-top:14px;">' +
                '<span class="step-label">' + data.urgency + ' PRIORITY</span>' +
                '<h3 style="margin-top:8px;">Clinical Recommendation</h3>' +
                '<p style="font-size:0.88rem; margin-bottom:0;">' + data.recommendation + '</p>' +
                '</div>'
              : '') +
            '<p style="font-size:0.8rem; margin-top:12px;">Result generated by the real trained TB Gatekeeper and Respiratory Classifier models. This is a screening-support tool, not a medical diagnosis — see <a href="legal.html">Legal &amp; Privacy</a>.</p>' +
            '</div>';
        })
        .catch(function () {
          setScreeningStep("result");
          resultPanel.style.display = "block";
          resultPanel.innerHTML = '<div class="notice"><h3>Couldn\'t Reach Backend</h3><p style="font-size:0.85rem;">Make sure Flask is running (<code>python app.py</code>) and try again.</p></div>';
        })
        .finally(function () {
          runScreeningBtn.removeAttribute("disabled");
          runScreeningBtn.textContent = "Run Screening";
        });
    });
  }

  // --- Real login (login.html) ---
  var loginBtn = document.querySelector("[data-login-btn]");
  if (loginBtn) {
    var loginStatus = document.querySelector("[data-login-status]");
    loginBtn.addEventListener("click", function () {
      var idField = document.getElementById("login-id");
      var pwField = document.getElementById("login-pw");
      var username = idField ? idField.value.trim() : "";
      var password = pwField ? pwField.value : "";
      if (!username || !password) {
        if (loginStatus) loginStatus.textContent = "Enter a username and password.";
        return;
      }
      loginBtn.setAttribute("disabled", "true");
      loginBtn.textContent = "Signing in...";

      fetch(API_BASE + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username, password: password })
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok) {
            sessionStorage.setItem("coughph_session", JSON.stringify({
              username: result.data.username,
              role: result.data.role,
              token: result.data.token
            }));
            if (loginStatus) loginStatus.textContent = "Signed in as " + result.data.username + " (" + result.data.role + "). Redirecting...";
            setTimeout(function () {
              window.location.href = result.data.role === "super_admin" ? "admin.html" : "dashboard.html";
            }, 500);
          } else {
            if (loginStatus) loginStatus.textContent = result.data.error || "Sign in failed.";
          }
        })
        .catch(function () {
          if (loginStatus) loginStatus.textContent = "Could not reach the backend server. Make sure Flask is running (python app.py).";
        })
        .finally(function () {
          loginBtn.removeAttribute("disabled");
          loginBtn.textContent = "Sign In";
        });
    });
  }

  // --- Registration (register.html) ---
  var registerBtn = document.querySelector("[data-register-btn]");
  if (registerBtn) {
    var registerStatus = document.querySelector("[data-register-status]");
    registerBtn.addEventListener("click", function () {
      var username = document.getElementById("reg-username").value.trim();
      var role = document.getElementById("reg-role").value;
      var password = document.getElementById("reg-password").value;
      var confirmPw = document.getElementById("reg-password-confirm").value;

      if (!username || !password) {
        registerStatus.textContent = "Fill in all fields.";
        return;
      }
      if (password !== confirmPw) {
        registerStatus.textContent = "Passwords do not match.";
        return;
      }

      registerBtn.setAttribute("disabled", "true");
      registerBtn.textContent = "Creating...";

      fetch(API_BASE + "/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username, password: password, role: role })
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok) {
            registerStatus.textContent = result.data.message + " Redirecting to sign in...";
            setTimeout(function () { window.location.href = "login.html"; }, 1500);
          } else {
            registerStatus.textContent = result.data.error || "Registration failed.";
          }
        })
        .catch(function () {
          registerStatus.textContent = "Could not reach the backend server. Make sure Flask is running (python app.py).";
        })
        .finally(function () {
          registerBtn.removeAttribute("disabled");
          registerBtn.textContent = "Create Account";
        });
    });
  }

  // --- Session helpers (dashboard.html, admin.html) ---
  function getSession() {
    try { return JSON.parse(sessionStorage.getItem("coughph_session")); }
    catch (e) { return null; }
  }

  var welcomeText = document.querySelector("[data-welcome-text]");
  var logoutBtn = document.querySelector("[data-logout-btn]");
  var screeningsTable = document.querySelector("[data-screenings-table]");
  var usersTable = document.querySelector("[data-users-table]");
  var metricsOverview = document.querySelector("[data-metrics-overview]");
  var metricsTable = document.querySelector("[data-metrics-table]");
  var session = null;

  if (welcomeText || logoutBtn || screeningsTable || usersTable) {
    session = getSession();
    if (!session) {
      window.location.href = "login.html";
      return;
    }
    if (welcomeText) welcomeText.textContent = "Signed in as " + session.username + " (" + session.role + ")";
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      fetch(API_BASE + "/api/logout", {
        method: "POST",
        headers: { "Authorization": "Bearer " + session.token }
      }).finally(function () {
        sessionStorage.removeItem("coughph_session");
        window.location.href = "login.html";
      });
    });
  }

  // --- Dashboard: live screenings table (dashboard.html) ---
  if (screeningsTable) {
    function loadScreenings() {
      fetch(API_BASE + "/api/screenings", {
        headers: { "Authorization": "Bearer " + session.token }
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (data) { throw new Error(data.error || "Request failed"); });
          return r.json();
        })
        .then(function (list) {
          if (!list.length) {
            screeningsTable.innerHTML = '<p style="font-size:0.85rem; color:var(--muted);">No screenings yet.</p>';
            return;
          }
          var rows = list.map(function (s) {
            var reviewedCell = s.reviewed_by_username
              ? s.reviewed_by_username
              : (session.role === "super_admin"
                  ? '<span style="color:var(--muted);">Not yet reviewed</span>'
                  : '<button class="btn" data-mark-reviewed data-screening-id="' + s.id + '">Mark as Reviewed</button>');
            return '<tr><td>' + s.created_at + '</td><td>' + s.patient_label + '</td><td>' +
              (s.phenotype || '-') + '</td><td>' + (s.prediction || '-') + '</td><td>' + reviewedCell + '</td><td>' +
              '<button class="btn" data-download-pdf data-screening-id="' + s.id + '">Download PDF</button></td></tr>';
          }).join('');
          screeningsTable.innerHTML = '<table><tr><th>Date</th><th>Patient</th><th>Phenotype</th><th>Prediction</th><th>Reviewed By</th><th></th></tr>' + rows + '</table>';

          screeningsTable.querySelectorAll("[data-mark-reviewed]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var id = btn.getAttribute("data-screening-id");
              btn.setAttribute("disabled", "true");
              btn.textContent = "Saving...";
              fetch(API_BASE + "/api/screenings/" + id + "/review", {
                method: "PATCH",
                headers: { "Authorization": "Bearer " + session.token }
              })
                .then(function (r) {
                  if (!r.ok) return r.json().then(function (data) { throw new Error(data.error || "Could not mark as reviewed."); });
                  loadScreenings();
                })
                .catch(function (err) {
                  alert(err.message);
                  btn.removeAttribute("disabled");
                  btn.textContent = "Mark as Reviewed";
                });
            });
          });

          screeningsTable.querySelectorAll("[data-download-pdf]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var id = btn.getAttribute("data-screening-id");
              var originalText = btn.textContent;
              btn.setAttribute("disabled", "true");
              btn.textContent = "Generating...";

              fetch(API_BASE + "/api/screenings/" + id + "/pdf", {
                headers: { "Authorization": "Bearer " + session.token }
              })
                .then(function (r) {
                  if (!r.ok) throw new Error("Could not generate PDF.");
                  return r.blob();
                })
                .then(function (blob) {
                  var url = URL.createObjectURL(blob);
                  var a = document.createElement("a");
                  a.href = url;
                  a.download = "coughph-screening-" + id + ".pdf";
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                })
                .catch(function () {
                  alert("Could not generate the PDF. Make sure the backend server is running.");
                })
                .finally(function () {
                  btn.removeAttribute("disabled");
                  btn.textContent = originalText;
                });
            });
          });
        })
        .catch(function (err) {
          screeningsTable.innerHTML = '<p style="font-size:0.85rem; color:var(--muted);">' + err.message + '</p>';
        });
    }
    loadScreenings();
  }

  // --- Admin: system performance metrics (admin.html) ---
  if (metricsOverview || metricsTable) {
    fetch(API_BASE + "/api/metrics/summary", {
      headers: { "Authorization": "Bearer " + session.token }
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (data) { throw new Error(data.error || "Request failed"); });
        return r.json();
      })
      .then(function (data) {
        var overall = data.overall;
        var errorRate = overall.total_requests
          ? ((overall.total_errors / overall.total_requests) * 100).toFixed(1)
          : "0.0";

        if (metricsOverview) {
          metricsOverview.innerHTML =
            '<div class="stat-card"><span class="stat-num">' + (overall.total_requests || 0) + '</span><span class="stat-label">Total Requests</span></div>' +
            '<div class="stat-card"><span class="stat-num">' + (overall.avg_ms != null ? overall.avg_ms + ' ms' : '-') + '</span><span class="stat-label">Avg Response Time</span></div>' +
            '<div class="stat-card' + (overall.total_errors > 0 ? ' stat-warn' : '') + '"><span class="stat-num">' + errorRate + '%</span><span class="stat-label">Error Rate</span></div>';
        }

        if (metricsTable) {
          if (!data.by_endpoint.length) {
            metricsTable.innerHTML = '<p style="font-size:0.85rem; color:var(--muted);">No requests logged yet.</p>';
            return;
          }
          var rows = data.by_endpoint.map(function (row) {
            return '<tr><td>' + row.method + ' ' + row.endpoint + '</td><td>' + row.request_count + '</td><td>' +
              row.avg_ms + ' ms</td><td>' + row.min_ms + ' ms</td><td>' + row.max_ms + ' ms</td><td>' +
              row.error_count + '</td></tr>';
          }).join('');
          metricsTable.innerHTML = '<table><tr><th>Endpoint</th><th>Requests</th><th>Avg</th><th>Min</th><th>Max</th><th>Errors</th></tr>' + rows + '</table>';
        }
      })
      .catch(function (err) {
        if (metricsTable) metricsTable.innerHTML = '<p style="font-size:0.85rem; color:var(--muted);">' + err.message + '</p>';
      });
  }

  // --- Admin: user approval table (admin.html) ---
  if (usersTable) {
    function loadUsers() {
      fetch(API_BASE + "/api/users", {
        headers: { "Authorization": "Bearer " + session.token }
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (data) { throw new Error(data.error || "Request failed"); });
          return r.json();
        })
        .then(function (list) {
          var rows = list.map(function (u) {
            var action = u.status === "approved"
              ? '<button class="btn" data-user-action data-user-id="' + u.id + '" data-status="rejected">Reject</button>'
              : '<button class="btn btn-primary" data-user-action data-user-id="' + u.id + '" data-status="approved">Approve</button>';
            return '<tr><td>' + u.username + '</td><td>' + u.role + '</td><td>' + u.status + '</td><td>' +
              (u.last_login_at || 'Never') + '</td><td>' + action + '</td></tr>';
          }).join('');
          usersTable.innerHTML = '<table><tr><th>Username</th><th>Role</th><th>Status</th><th>Last Login</th><th></th></tr>' + rows + '</table>';
          usersTable.querySelectorAll("[data-user-action]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var id = btn.getAttribute("data-user-id");
              var status = btn.getAttribute("data-status");
              fetch(API_BASE + "/api/users/" + id + "/status", {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": "Bearer " + session.token
                },
                body: JSON.stringify({ status: status })
              }).then(function () { loadUsers(); });
            });
          });
        })
        .catch(function (err) {
          usersTable.innerHTML = '<p style="font-size:0.85rem; color:var(--muted);">' + err.message + '</p>';
        });
    }
    loadUsers();
  }
});
