/* Beam — peer-to-peer text & file beaming (WebRTC via PeerJS).
 *
 * How it works:
 *  1. Each browser gets a random peer ID from the free PeerJS cloud.
 *     The cloud server only introduces peers; it never sees content.
 *  2. Pairing: device A shows a QR code containing its page URL +
 *     its peer ID. Device B scans it, opens that URL, and auto-connects.
 *  3. Text and files then travel directly over a WebRTC data channel.
 *  4. Files are split into 16 KB chunks so large transfers stay reliable.
 */

(function () {
  "use strict";

  var CHUNK_SIZE = 16 * 1024;

  var statusDot = document.getElementById("statusDot");
  var statusText = document.getElementById("statusText");
  var myIdEl = document.getElementById("myId");
  var qrEl = document.getElementById("qrcode");
  var peerIdInput = document.getElementById("peerIdInput");
  var connectBtn = document.getElementById("connectBtn");
  var copyIdBtn = document.getElementById("copyId");
  var textInput = document.getElementById("textInput");
  var sendTextBtn = document.getElementById("sendTextBtn");
  var fileInput = document.getElementById("fileInput");
  var sendFileBtn = document.getElementById("sendFileBtn");
  var progressEl = document.getElementById("progress");
  var historyEl = document.getElementById("history");
  var emptyNote = document.getElementById("emptyNote");

  var peer = null;
  var conn = null;
  var connectTimer = null;
  var incomingFile = null; // { name, size, type, chunks: [], received: 0 }

  function setStatus(state, message) {
    statusDot.className = "dot " + state;
    statusText.textContent = message;
  }

  function randomId() {
    return "beam-" + Math.random().toString(36).slice(2, 8);
  }

  // Keep the same code on this browser across reloads, so a QR code
  // scanned earlier does not go stale just because the page refreshed.
  function getPeerId() {
    try {
      var saved = localStorage.getItem("beam-peer-id");
      if (saved) return saved;
      var id = randomId();
      localStorage.setItem("beam-peer-id", id);
      return id;
    } catch (e) {
      return randomId();
    }
  }

  function playWhoosh() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(980, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (e) { /* sound is optional; never break the transfer */ }
  }

  function addHistoryItem(node) {
    emptyNote.style.display = "none";
    var li = document.createElement("li");
    li.appendChild(node);
    historyEl.prepend(li);
  }

  function saveTextLocally(text) {
    try {
      var saved = JSON.parse(localStorage.getItem("beam-texts") || "[]");
      saved.unshift({ text: text, at: new Date().toISOString() });
      localStorage.setItem("beam-texts", JSON.stringify(saved.slice(0, 50)));
    } catch (e) { /* private mode etc. — history just won't persist */ }
  }

  function showReceivedText(text) {
    var wrap = document.createElement("div");
    var pre = document.createElement("pre");
    pre.textContent = text;
    var copy = document.createElement("button");
    copy.textContent = "Copy";
    copy.onclick = function () {
      navigator.clipboard.writeText(text).then(function () {
        copy.textContent = "Copied ✓";
        setTimeout(function () { copy.textContent = "Copy"; }, 1500);
      });
    };
    wrap.appendChild(pre);
    wrap.appendChild(copy);
    addHistoryItem(wrap);
    saveTextLocally(text);
    playWhoosh();
  }

  function showReceivedFile(name, blob) {
    var wrap = document.createElement("div");
    var span = document.createElement("span");
    span.textContent = "📄 " + name + " (" +
      (blob.size / 1024).toFixed(1) + " KB) ";
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.textContent = "Download";
    wrap.appendChild(span);
    wrap.appendChild(a);
    addHistoryItem(wrap);
    playWhoosh();
  }

  function handleData(data) {
    if (data.type === "text") {
      showReceivedText(data.text);
    } else if (data.type === "file-meta") {
      incomingFile = { name: data.name, size: data.size, type: data.type,
                       chunks: [], received: 0 };
      progressEl.textContent = "Receiving " + data.name + "…";
    } else if (data.type === "file-chunk" && incomingFile) {
      incomingFile.chunks.push(data.chunk);
      incomingFile.received += data.chunk.byteLength;
      var pct = Math.round(incomingFile.received / incomingFile.size * 100);
      progressEl.textContent = "Receiving " + incomingFile.name +
        "… " + pct + "%";
    } else if (data.type === "file-end" && incomingFile) {
      var blob = new Blob(incomingFile.chunks, { type: incomingFile.type });
      progressEl.textContent = "Received " + incomingFile.name + " ✓";
      showReceivedFile(incomingFile.name, blob);
      incomingFile = null;
    }
  }

  function bindConnection(connection) {
    conn = connection;
    conn.on("open", function () {
      clearTimeout(connectTimer);
      setStatus("ok", "Connected ✓ — you can beam now.");
    });
    conn.on("data", handleData);
    conn.on("close", function () {
      setStatus("idle", "Peer left. Scan a new QR code to reconnect.");
      conn = null;
    });
  }

  function connectTo(id) {
    if (!id) return;
    setStatus("busy", "Connecting…");
    bindConnection(peer.connect(id.trim()));
    // If the other side never answers, say so plainly instead of
    // spinning forever — usually the code is stale or that tab closed.
    clearTimeout(connectTimer);
    connectTimer = setTimeout(function () {
      if (!conn || !conn.open) {
        setStatus("bad", "Still connecting… Is the other device's Beam " +
          "page still open with this same code? Re-scan its fresh QR " +
          "code and try again.");
      }
    }, 10000);
  }

  function sendFile(file) {
    if (!conn) { alert("Connect to another device first."); return; }
    conn.send({ type: "file-meta", name: file.name, size: file.size,
                type: file.type });
    file.arrayBuffer().then(function (buffer) {
      var total = Math.ceil(buffer.byteLength / CHUNK_SIZE);
      for (var i = 0; i < total; i++) {
        conn.send({ type: "file-chunk",
                    chunk: buffer.slice(i * CHUNK_SIZE,
                                        (i + 1) * CHUNK_SIZE) });
      }
      conn.send({ type: "file-end" });
      progressEl.textContent = "Sent " + file.name + " ✓";
      playWhoosh();
    });
  }

  // --- wire up the UI ------------------------------------------------
  copyIdBtn.onclick = function () {
    navigator.clipboard.writeText(myIdEl.textContent);
    copyIdBtn.textContent = "Copied ✓";
    setTimeout(function () { copyIdBtn.textContent = "Copy"; }, 1500);
  };

  connectBtn.onclick = function () { connectTo(peerIdInput.value); };

  sendTextBtn.onclick = function () {
    if (!conn) { alert("Connect to another device first."); return; }
    var text = textInput.value;
    if (!text.trim()) return;
    conn.send({ type: "text", text: text });
    textInput.value = "";
    progressEl.textContent = "Text beamed ✓";
    playWhoosh();
  };

  sendFileBtn.onclick = function () {
    if (!fileInput.files.length) {
      alert("Choose a file first.");
      return;
    }
    sendFile(fileInput.files[0]);
  };

  // Restore locally saved texts from earlier sessions.
  try {
    JSON.parse(localStorage.getItem("beam-texts") || "[]")
      .forEach(function (item) {
        var wrap = document.createElement("div");
        var pre = document.createElement("pre");
        pre.textContent = item.text;
        wrap.appendChild(pre);
        addHistoryItem(wrap);
      });
  } catch (e) { /* ignore */ }

  // --- start the peer -------------------------------------------------
  if (typeof Peer === "undefined") {
    setStatus("bad", "Could not load the connection library. " +
      "Check your internet connection and reload.");
    return;
  }
  peer = new Peer(getPeerId());
  peer.on("open", function (id) {
    myIdEl.textContent = id;
    var base = window.location.href.split("?")[0];
    var link = base + "?peer=" + encodeURIComponent(id);
    if (typeof QRCode !== "undefined") {
      new QRCode(qrEl, { text: link, width: 160, height: 160 });
    }
    setStatus("idle", "Ready. Scan the QR code from the other device.");
    var params = new URLSearchParams(window.location.search);
    var remote = params.get("peer");
    if (remote) {
      peerIdInput.value = remote;
      connectTo(remote);
    }
  });
  peer.on("connection", bindConnection);
  peer.on("error", function (err) {
    clearTimeout(connectTimer);
    if (err.type === "peer-unavailable") {
      setStatus("bad", "That code is not online — the other device may " +
        "have closed Beam or reloaded. Scan its fresh QR code and try again.");
    } else {
      setStatus("bad", "Connection problem: " + err.type +
        ". Reload and try again — strict networks sometimes block P2P.");
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
