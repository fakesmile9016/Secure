# Quiet — private chat and voice

Quiet is a browser-based chat with client-side AES-256-GCM encryption and one-to-one WebRTC voice calls. The server relays encrypted packets and keeps no chat history.

## Run locally

```powershell
cd backend
npm.cmd install
npm.cmd run dev
```

Open [http://localhost:5000](http://localhost:5000). For voice calls, allow microphone access. Calls require HTTPS in deployment (localhost is allowed for development).

MongoDB is optional for chat and calls. Configure `MONGODB_URI` in `backend/.env` to enable the existing authentication API. Configure `CLIENT_URL` when serving the client from a different origin.

## Using Quiet

1. Choose a display name and start a private room.
2. Share the generated invite link with the person you want to chat with. The encryption key is in the URL fragment, which browsers do not send to the server.
3. Use **Voice call** for an encrypted, one-to-one WebRTC call.

Room keys are generated in the browser and are never transmitted to the server. Messages, shared photos, documents, and call signaling use AES-GCM with a fresh random nonce per packet; WebRTC encrypts voice media in transit. Photos can be previewed in the chat, and other files can be downloaded by room members. Attachments are limited to 5 MB and, like messages, are only kept in the current page and disappear when it is closed or refreshed.

This is a lightweight prototype, not a professionally audited messaging protocol. Anyone with the invite link can read and send messages in that room, and a shared room key does not provide forward secrecy or verified member identities. Voice connectivity uses a public STUN server, which may learn network connection metadata; some restrictive networks may also block direct calls. Deploy behind HTTPS and share invite links only through a trusted channel.
