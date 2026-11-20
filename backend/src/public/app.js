(() => {
  const $ = (selector) => document.querySelector(selector);
  const welcome = $("#welcome");
  const chatApp = $("#chat-app");
  const socket = io();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const state = {
    room: null,
    key: null,
    rawKey: null,
    packetQueue: Promise.resolve(),
    name: localStorage.getItem("quiet-name") || "",
    peer: null,
    localStream: null,
    pendingOffer: null,
    pendingCandidates: [],
    muted: false,
    memberCount: 1,
    toastTimer: null,
  };
  const maxAttachmentSize = 5 * 1024 * 1024;
  const previewImageTypes = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

  $("#display-name").value = state.name;

  const toBase64Url = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

  const fromBase64Url = (value) => {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  };

  const showToast = (message) => {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
  };

  const setError = (message = "") => {
    $("#welcome-error").textContent = message;
  };

  const makeInvite = () => {
    const link = new URL(location.href);
    link.hash = `room=${encodeURIComponent(state.room)}&key=${encodeURIComponent(toBase64Url(state.rawKey))}`;
    return link.toString();
  };

  const createRoomCredentials = () => {
    state.room = toBase64Url(crypto.getRandomValues(new Uint8Array(12)));
    state.rawKey = crypto.getRandomValues(new Uint8Array(32));
  };

  const parseInvite = (text) => {
    let url;
    try {
      url = new URL(text, location.href);
    } catch {
      throw new Error("That invite link doesn’t look right.");
    }

    const values = new URLSearchParams(url.hash.replace(/^#/, ""));
    const room = values.get("room");
    const keyText = values.get("key");
    if (!room || !/^[A-Za-z0-9_-]{12,80}$/.test(room) || !keyText) {
      throw new Error("This invite link is missing its room key.");
    }
    if (keyText.length !== 43) throw new Error("This invite link has an invalid room key.");
    let key;
    try {
      key = fromBase64Url(keyText);
    } catch {
      throw new Error("This invite link has an invalid room key.");
    }
    if (key.length !== 32) throw new Error("This invite link has an invalid room key.");
    return { room, key };
  };

  const encrypt = async (payload) => {
    const pending = state.packetQueue.then(async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        state.key,
        encoder.encode(JSON.stringify(payload)),
      );
      socket.emit("encrypted-packet", {
        iv: toBase64Url(iv),
        data: toBase64Url(encrypted),
      });
    });
    state.packetQueue = pending.catch(() => {});
    return pending;
  };

  const sendSystemNote = (text) => {
    const note = document.createElement("div");
    note.className = "system-note";
    note.textContent = text;
    $("#message-list").append(note);
    note.scrollIntoView({ block: "nearest" });
  };

  const appendMessage = ({ name, text, attachment, time = Date.now(), mine = false }) => {
    const list = $("#message-list");
    const note = list.querySelector(".welcome-note");
    if (note) note.remove();

    const row = document.createElement("article");
    row.className = `message${mine ? " mine" : ""}`;
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = (name || "?").trim().charAt(0).toUpperCase() || "?";
    const body = document.createElement("div");
    body.className = "message-body";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const author = document.createElement("strong");
    author.textContent = mine ? "You" : name;
    const timestamp = document.createElement("span");
    timestamp.textContent = new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    let bubble;
    if (attachment) {
      const attachmentLink = document.createElement("a");
      attachmentLink.className = "message-attachment";
      attachmentLink.href = attachment.url;
      attachmentLink.download = attachment.name;
      if (attachment.preview) {
        const image = document.createElement("img");
        image.className = "message-image";
        image.src = attachment.url;
        image.alt = attachment.name;
        attachmentLink.append(image);
      } else {
        const card = document.createElement("span");
        card.className = "file-card";
        const icon = document.createElement("span");
        icon.className = "file-icon";
        icon.textContent = attachment.extension || "FILE";
        const details = document.createElement("span");
        details.className = "file-details";
        const fileName = document.createElement("strong");
        fileName.textContent = attachment.name;
        const fileSize = document.createElement("small");
        fileSize.textContent = formatFileSize(attachment.size);
        details.append(fileName, fileSize);
        card.append(icon, details);
        attachmentLink.append(card);
      }
      bubble = attachmentLink;
    } else {
      bubble = document.createElement("div");
      bubble.className = "message-bubble";
      bubble.textContent = text;
    }
    meta.append(author, timestamp);
    body.append(meta, bubble);
    row.append(avatar, body);
    list.append(row);
    list.scrollTop = list.scrollHeight;
  };

  const formatFileSize = (size) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const bytesToBase64Url = (bytes) => {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };

  const sendAttachment = async (file) => {
    if (!state.key || !file) return;
    if (file.size > maxAttachmentSize) {
      showToast("Files must be 5 MB or smaller.");
      return;
    }
    if (file.size === 0) {
      showToast("That file is empty.");
      return;
    }
    const data = bytesToBase64Url(new Uint8Array(await file.arrayBuffer()));
    await encrypt({
      type: "file",
      name: file.name.slice(0, 255) || "attachment",
      mime: file.type || "application/octet-stream",
      size: file.size,
      data,
      time: Date.now(),
    });
    const url = URL.createObjectURL(file);
    appendMessage({
      name: state.name,
      attachment: {
        name: file.name.slice(0, 255) || "attachment",
        size: file.size,
        url,
        preview: previewImageTypes.has(file.type),
        extension: file.name.includes(".") ? file.name.split(".").pop().slice(0, 5) || "FILE" : "FILE",
      },
      mine: true,
    });
  };

  const updateCount = (count) => {
    state.memberCount = count;
    $("#member-count").textContent = String(count);
  };

  const openChat = async (credentials) => {
    state.room = credentials.room;
    state.rawKey = new Uint8Array(credentials.key);
    state.key = await crypto.subtle.importKey("raw", state.rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    state.name = $("#display-name").value.trim().slice(0, 28) || "Guest";
    localStorage.setItem("quiet-name", state.name);
    welcome.classList.add("hidden");
    chatApp.classList.remove("hidden");
    $("#profile-name").textContent = state.name;
    $("#profile-avatar").textContent = state.name.charAt(0).toUpperCase();
    $("#sidebar-room-name").textContent = `Room ${state.room.slice(0, 6)}`;
    $("#room-title").textContent = `Room ${state.room.slice(0, 6)}`;
    history.replaceState(null, "", `${location.pathname}${location.search}#room=${encodeURIComponent(state.room)}&key=${encodeURIComponent(toBase64Url(state.rawKey))}`);
    socket.emit("join-room", state.room, (result) => {
      if (result?.error) showToast(result.error);
    });
    if (!socket.connected) socket.connect();
    $("#message-input").focus();
  };

  const invite = async () => {
    try {
      await navigator.clipboard.writeText(makeInvite());
      showToast("Invite link copied. Share it only with someone you trust.");
    } catch {
      const link = makeInvite();
      window.prompt("Copy this private invite link:", link);
    }
  };

  const refreshDetails = async () => {
    $("#detail-room-id").textContent = state.room;
    const digest = await crypto.subtle.digest("SHA-256", state.rawKey);
    $("#detail-fingerprint").textContent = toBase64Url(digest).match(/.{1,4}/g).join(" ");
  };

  const showDetails = async () => {
    await refreshDetails();
    $("#details-dialog").showModal();
  };

  const cleanupCall = () => {
    if (state.peer) {
      state.peer.ontrack = null;
      state.peer.onicecandidate = null;
      state.peer.close();
      state.peer = null;
    }
    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => track.stop());
      state.localStream = null;
    }
    $("#remote-audio").srcObject = null;
    $("#call-status").classList.add("hidden");
    $("#mute-button").classList.remove("is-muted");
    state.muted = false;
    state.pendingOffer = null;
    state.pendingCandidates = [];
  };

  const createPeer = async () => {
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    state.peer = peer;
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) encrypt({ type: "ice-candidate", candidate: candidate.toJSON() });
    };
    peer.ontrack = ({ streams }) => {
      $("#remote-audio").srcObject = streams[0];
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        $("#call-status-subtitle").textContent = "Voice is encrypted peer to peer";
      } else if (["failed", "disconnected"].includes(peer.connectionState)) {
        $("#call-status-subtitle").textContent = "Connection interrupted";
      }
    };
    return peer;
  };

  const beginCall = async () => {
    if (state.peer) return;
    if (state.memberCount > 2) {
      showToast("Voice calls are currently one-to-one. Ask others to leave this room first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Voice calls need microphone access on HTTPS or localhost.");
      return;
    }
    try {
      $("#call-button").disabled = true;
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const peer = await createPeer();
      state.localStream.getTracks().forEach((track) => peer.addTrack(track, state.localStream));
      $("#call-status").classList.remove("hidden");
      $("#call-status-title").textContent = "Calling room";
      $("#call-status-subtitle").textContent = "Waiting for someone to answer…";
      await peer.setLocalDescription(await peer.createOffer());
      await encrypt({ type: "call-offer", sdp: peer.localDescription });
    } catch (error) {
      cleanupCall();
      showToast(error.name === "NotAllowedError" ? "Microphone permission was denied." : "Could not start the call.");
    } finally {
      $("#call-button").disabled = false;
    }
  };

  const acceptCall = async () => {
    const offer = state.pendingOffer;
    if (!offer || !navigator.mediaDevices?.getUserMedia) return;
    $("#incoming-dialog").close();
    try {
      state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const peer = await createPeer();
      state.localStream.getTracks().forEach((track) => peer.addTrack(track, state.localStream));
      await peer.setRemoteDescription(offer.sdp);
      for (const candidate of state.pendingCandidates) {
        await peer.addIceCandidate(candidate);
      }
      state.pendingCandidates = [];
      await peer.setLocalDescription(await peer.createAnswer());
      await encrypt({ type: "call-answer", sdp: peer.localDescription });
      $("#call-status").classList.remove("hidden");
      $("#call-status-title").textContent = "Voice call";
      $("#call-status-subtitle").textContent = "Connecting securely…";
      state.pendingOffer = null;
    } catch (error) {
      cleanupCall();
      showToast(error.name === "NotAllowedError" ? "Microphone permission was denied." : "Could not answer the call.");
    }
  };

  const handlePacket = async (packet) => {
    if (!packet?.iv || !packet?.data || !state.key) return;
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64Url(packet.iv) },
        state.key,
        fromBase64Url(packet.data),
      );
      const payload = JSON.parse(decoder.decode(plaintext));
      switch (payload.type) {
        case "chat":
          if (typeof payload.text === "string" && payload.text.length <= 4000) {
            appendMessage({ name: String(payload.name || "Guest").slice(0, 28), text: payload.text, time: payload.time });
          }
          break;
        case "file":
          if (
            typeof payload.data === "string" &&
            payload.data.length <= 7_500_000 &&
            typeof payload.name === "string" &&
            Number.isSafeInteger(payload.size) &&
            payload.size > 0 &&
            payload.size <= maxAttachmentSize
          ) {
            const bytes = fromBase64Url(payload.data);
            if (bytes.length === payload.size) {
              const mime = typeof payload.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(payload.mime)
                ? payload.mime
                : "application/octet-stream";
              const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
              const name = payload.name.slice(0, 255) || "attachment";
              appendMessage({
                name: String(payload.name || "Guest").slice(0, 28),
                attachment: {
                  name,
                  size: payload.size,
                  url,
                  preview: previewImageTypes.has(mime),
                  extension: name.includes(".") ? name.split(".").pop().slice(0, 5) || "FILE" : "FILE",
                },
                time: payload.time,
              });
            }
          }
          break;
        case "call-offer":
          if (state.memberCount > 2) {
            showToast("Voice calls are currently one-to-one.");
          } else if (!state.peer && payload.sdp?.type === "offer") {
            state.pendingOffer = payload;
            $("#incoming-name").textContent = "A room member is calling";
            $("#incoming-dialog").showModal();
          }
          break;
        case "call-answer":
          if (state.peer && payload.sdp?.type === "answer" && !state.peer.remoteDescription) {
            await state.peer.setRemoteDescription(payload.sdp);
            for (const candidate of state.pendingCandidates) await state.peer.addIceCandidate(candidate);
            state.pendingCandidates = [];
          }
          break;
        case "ice-candidate":
          if (payload.candidate) {
            if (state.peer?.remoteDescription) await state.peer.addIceCandidate(payload.candidate);
            else state.pendingCandidates.push(payload.candidate);
          }
          break;
        case "call-end":
          cleanupCall();
          $("#incoming-dialog").close();
          showToast("The voice call ended.");
          break;
        default:
          break;
      }
    } catch {
      showToast("Could not decrypt a message. Check that you joined with the right invite link.");
    }
  };

  $("#create-room").addEventListener("click", async () => {
    setError();
    if (!window.crypto?.subtle) {
      setError("This browser does not support secure encryption.");
      return;
    }
    createRoomCredentials();
    await openChat({ room: state.room, key: state.rawKey });
    setTimeout(invite, 250);
  });

  const joinFromField = async () => {
    setError();
    try {
      if (!window.crypto?.subtle) throw new Error("This browser does not support secure encryption.");
      const credentials = parseInvite($("#invite-link").value.trim());
      await openChat(credentials);
    } catch (error) {
      setError(error.message);
    }
  };
  $("#join-room").addEventListener("click", joinFromField);
  $("#invite-link").addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinFromField();
  });
  $("#message-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#message-input");
    const text = input.value.trim();
    if (!text || !state.key) return;
    input.value = "";
    appendMessage({ name: state.name, text, mine: true });
    try {
      await encrypt({ type: "chat", name: state.name, text, time: Date.now() });
    } catch {
      showToast("Message could not be encrypted or sent.");
    }
  });
  $("#attachment-button").addEventListener("click", () => $("#attachment-input").click());
  $("#attachment-input").addEventListener("change", async (event) => {
    const input = event.currentTarget;
    const file = input.files[0];
    input.value = "";
    try {
      await sendAttachment(file);
    } catch {
      showToast("File could not be encrypted or sent.");
    }
  });
  $("#invite-button").addEventListener("click", invite);
  $("#note-invite").addEventListener("click", invite);
  $("#details-invite").addEventListener("click", invite);
  $("#show-key").addEventListener("click", showDetails);
  $("#banner-details").addEventListener("click", showDetails);
  $("#new-room").addEventListener("click", () => location.assign(location.pathname));
  $("#leave-room").addEventListener("click", () => {
    cleanupCall();
    socket.disconnect();
    history.replaceState(null, "", location.pathname);
    location.reload();
  });
  $("#call-button").addEventListener("click", beginCall);
  $("#accept-call").addEventListener("click", acceptCall);
  $("#decline-call").addEventListener("click", async () => {
    $("#incoming-dialog").close();
    state.pendingOffer = null;
    await encrypt({ type: "call-end" });
  });
  $("#hangup-button").addEventListener("click", async () => {
    await encrypt({ type: "call-end" });
    cleanupCall();
  });
  $("#mute-button").addEventListener("click", () => {
    state.muted = !state.muted;
    state.localStream?.getAudioTracks().forEach((track) => { track.enabled = !state.muted; });
    $("#mute-button").classList.toggle("is-muted", state.muted);
    $("#mute-button").title = state.muted ? "Unmute microphone" : "Mute microphone";
  });
  $("#emoji-button").addEventListener("click", () => {
    const input = $("#message-input");
    input.value += "☺";
    input.focus();
  });

  socket.on("connect", () => {
    if (state.room) socket.emit("join-room", state.room);
  });
  socket.on("room-count", updateCount);
  socket.on("encrypted-packet", handlePacket);
  socket.on("connect_error", () => showToast("Can’t connect to the room server. Try again in a moment."));

  if (location.hash) {
    $("#invite-link").value = location.href;
    try {
      const credentials = parseInvite(location.href);
      if (state.name) {
        openChat(credentials);
      } else {
        $("#display-name").focus();
        showToast("Add your name, then paste the invite link to join.");
      }
    } catch (error) {
      setError(error.message);
    }
  }
})();
