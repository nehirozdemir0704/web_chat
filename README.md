# Discord-like Real-Time Chat App (Node.js + WebSocket)

```
Project Structure:

web_socket/
├── backend/
│   ├── server.js
│   └── package.json
├── frontend/
│   └── public/
│       ├── index.html
│       └── app.js
└── README.md
```

## Features
- User registration & login
- Public and private channels (Discord-style)
- Real-time messaging (WebSocket)
- Invite system for private channels
- Modern SPA UI (Tailwind CSS)
- All updates in real-time, no page refresh

## Setup & Run
1. Install backend dependencies:
   ```
   cd backend
   npm install
   ```
2. Start the server (serves both backend and frontend):
   ```
   npm start
   ```
3. Open your browser at [http://localhost:3000](http://localhost:3000)

## Open In VS Code
1. Open the folder `/Users/nehir/Documents/New project` in VS Code.
2. Or open the workspace file `web_chat.code-workspace`.
3. Run the VS Code task `Install Backend Dependencies`.
4. Then use:
   - `Run and Debug` -> `Run Community Server`, or
   - task `Start App`
5. Open `http://localhost:3000`

## Project Checklist For Demo
- Server creation
- Category creation
- Channel creation under categories
- Role matrix: admin / mod / member
- Role-based channel visibility
- Moderation: mute / unmute / ban
- Message reporting
- Voice room join / leave simulation
- Presence status: online / away / busy
- Slash commands: `/help`, `/stats`, `/poll`

## ASCII Architecture Diagram

```
+-------------------+
|   Browser (SPA)   |
|-------------------|
|  index.html/app.js|
+---------+---------+
          |
          | HTTP (REST: login, register, channels)
          |
+---------v---------+
|   Express Server  |
|-------------------|
|  server.js        |
|  (serves static)  |
+---------+---------+
          |
          | WebSocket (real-time)
          |
+---------v---------+
|   WebSocket (ws)  |
|-------------------|
|  Real-time events |
+-------------------+
```

## WebSocket vs HTTP (Blog-Style)

**HTTP** is request-response: the browser asks, the server answers. For every update (like a new message), the client must ask again. This is slow for real-time apps.

**WebSocket** is a persistent, two-way connection. Once open, both client and server can send messages at any time. This enables instant updates—perfect for chat, games, and collaborative tools.

**In this project:**
- HTTP is used for login, registration, and initial data fetches.
- WebSocket is used for all real-time events: messages, channel updates, invites.

## Usage Notes
- All users see public channels. Private channels are only visible to invited members.
- Channel list and messages update instantly for all users.
- Invite users to private channels via the Invite button.
- No page refresh is needed—everything updates live!

---

**Enjoy your Discord-like chat app!** 

## Render Deploy

This project is now prepared for a single-service Render deployment with Docker.

### Files added for deployment
- `Dockerfile`: Builds the backend and serves the frontend from the same Node process
- `render.yaml`: Lets Render detect the web service automatically
- `.dockerignore`: Keeps the Docker build context smaller

### Deploy steps
1. Push this repository to GitHub.
2. Go to Render and create a new `Blueprint` or `Web Service` from the repo.
3. Render will detect `render.yaml` and the root `Dockerfile`.
4. After the deploy finishes, open the generated Render URL.

### Quick public URL flow
1. Push your latest code to GitHub.
2. Open [Render](https://render.com/) and sign in with GitHub.
3. Click `New +` -> `Blueprint`.
4. Select this repository.
5. Wait for the deploy to finish.
6. Open the generated `https://...onrender.com` URL.

### Why this solves the Wi-Fi limitation
- `localhost` and `192.168.x.x` only work on your own machine or local network.
- A Render URL works over the public internet.
- WebSocket and browser camera permissions work much better on `https`.

### Health check
- After deploy, you can test the server with:
  - `/healthz`
  - example: `https://your-app.onrender.com/healthz`

### Important note
- App data is currently stored in `backend/data/state.json`.
- On Render free instances, local file data may reset after restart/redeploy.
- If you need permanent production data, move state to a database.


# WebSocket Chat Uygulaması

## WebSocket Nedir?
WebSocket, istemci (tarayıcı) ile sunucu arasında gerçek zamanlı, çift yönlü ve sürekli bir bağlantı kurmayı sağlayan bir iletişim protokolüdür. HTTP'den farklı olarak, bağlantı bir kez kurulur ve iki taraf da istediği zaman veri gönderebilir.

## Avantajları
- **Düşük gecikme**: Anlık veri iletimi sağlar.
- **Çift yönlü iletişim**: Hem istemci hem sunucu istediği zaman mesaj gönderebilir.
- **Düşük bant genişliği**: Tek bir bağlantı üzerinden sürekli veri akışı.

## Kullanım Alanları
- Canlı sohbet uygulamaları
- Online oyunlar
- Finansal veri akışı
- Gerçek zamanlı bildirimler
- Canlı skor ve analiz panelleri

## Uygulama Mimarisi (ASCII Diyagram)

```
+-------------------+         WebSocket         +-------------------+
|   Kullanıcı 1     | <----------------------> |                   |
|  (Tarayıcı/Client)|                         |    Sunucu (Node)   |
+-------------------+ <----------------------> |                   |
|   Kullanıcı 2     |         WebSocket        +-------------------+
|  (Tarayıcı/Client)|
+-------------------+
```

## Kurulum ve Çalıştırma

1. **Projeyi klonla veya indir:**
2. **Bağımlılıkları yükle:**
   ```sh
   npm install
   ```
3. **Sunucuyu başlat:**
   ```sh
   node server.js
   ```
4. **İstemciyi aç:**
   `client.html` dosyasını tarayıcıda aç.

## Kod Örnekleri

### Sunucu (Node.js)
```js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });
wss.on('connection', ws => {
  ws.send('Hoş geldin!');
  ws.on('message', msg => {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  });
});
```

### İstemci (HTML + JS)
```html
<input id="username" type="text" placeholder="Kullanıcı adınız">
<div id="messages"></div>
<input id="msg" type="text" placeholder="Mesaj yaz...">
<button onclick="sendMsg()">Gönder</button>
<script>
  const ws = new WebSocket('ws://localhost:8080');
  ws.onmessage = (event) => log(event.data);
  function sendMsg() {
    const user = username.value.trim();
    const msg = msgInput.value.trim();
    ws.send(JSON.stringify({ user, msg }));
  }
</script>
```

## WebSocket Akış Diyagramı (ASCII)

```
Kullanıcı         Sunucu
   |                |
   |--- Bağlan ---> |
   |                |
   |<-- Hoş geldin--|
   |                |
   |--- Mesaj ------>
   |                |
   |<-- Mesaj ------|
   |                |
```

## Kaynaklar
- [WebSocket: A Real-Time Communication Protocol Explained (Ramotion)](https://www.ramotion.com/blog/what-is-websocket/)
- [What are WebSockets, and how do Websockets work? (PubNub)](https://www.pubnub.com/blog/what-are-websockets/)

---

> Bu proje, gerçek zamanlı chat uygulamalarının temelini anlamak ve WebSocket protokolünü pratikte görmek isteyenler için hazırlanmıştır.


# WebSocket ile Gerçek Zamanlı Haberleşme ve HTTP Karşılaştırması

## Giriş
Web uygulamalarında istemci (tarayıcı) ile sunucu arasında iletişim kurmak için iki temel protokol öne çıkar: **HTTP** ve **WebSocket**. Her ikisi de TCP üzerinde çalışır, ancak tasarım amaçları, veri akışı ve kullanım alanları bakımından önemli farklılıklar gösterir. Bu dokümanda, WebSocket protokolünü derinlemesine inceleyecek, HTTP ile farklarını, avantajlarını, dezavantajlarını, kullanım alanlarını ve örnek uygulama mimarisini detaylıca ele alacağız.

---

## HTTP Nedir?
HTTP (Hypertext Transfer Protocol), webin temel taşıdır. İstemci-sunucu arasında **istek-cevap (request-response)** modeliyle çalışır. Her veri alışverişi için yeni bir bağlantı açılır ve işlem tamamlanınca bağlantı kapanır. HTTP **stateless** (durumsuz) bir protokoldür; her istek bağımsızdır ve sunucu istemcinin önceki isteklerini hatırlamaz.

### HTTP'nin Temel Özellikleri
- **Tek yönlü iletişim:** Sadece istemci istek başlatır, sunucu cevap verir.
- **Kısa ömürlü bağlantı:** Her istek için yeni bağlantı açılır, işlem bitince kapanır.
- **Stateless:** Sunucu, istemcinin önceki isteklerini hatırlamaz.
- **Kolay önbellekleme:** Statik içeriklerde çok etkilidir.
- **Geniş destek:** Tüm tarayıcılar ve sunucular tarafından desteklenir.

### HTTP Kullanım Alanları
- Web sayfası yükleme
- Form gönderimi
- REST API iletişimi
- Dosya indirme/yükleme
- Statik içerik sunumu

---

## WebSocket Nedir?
WebSocket, istemci ve sunucu arasında **gerçek zamanlı, çift yönlü (full-duplex)** ve sürekli bir bağlantı kurmayı sağlayan bir protokoldür. Bağlantı bir kez kurulur ve iki taraf da istediği zaman veri gönderebilir. WebSocket, HTTP üzerinden başlatılır (Upgrade isteğiyle) ve ardından TCP üzerinde kendi protokolüne geçer.

### WebSocket'in Temel Özellikleri
- **Çift yönlü iletişim:** Hem istemci hem sunucu istediği zaman mesaj gönderebilir.
- **Sürekli bağlantı:** Bağlantı açık kaldığı sürece veri akışı devam eder.
- **Düşük gecikme:** Her mesaj için yeni bağlantı kurulmaz, anlık veri iletimi sağlar.
- **Durumlu (stateful):** Sunucu, bağlı istemcileri takip eder.
- **Gerçek zamanlı uygulamalar için ideal.**

### WebSocket Kullanım Alanları
- Canlı sohbet uygulamaları
- Online oyunlar
- Finansal veri akışı (borsa, kripto)
- Gerçek zamanlı bildirimler
- Canlı skor ve analiz panelleri
- IoT cihaz yönetimi

---

## HTTP ve WebSocket Karşılaştırması

| Özellik                | HTTP                                      | WebSocket                                 |
|------------------------|--------------------------------------------|--------------------------------------------|
| İletişim Yönü          | Tek yönlü (client -> server)               | Çift yönlü (client <-> server)             |
| Bağlantı Tipi          | Kısa ömürlü, her istek için yeni bağlantı  | Sürekli, tek bağlantı                      |
| Protokol Durumu        | Stateless (durumsuz)                       | Stateful (durumlu)                         |
| Gecikme                | Yüksek (her istek için el sıkışma)         | Düşük (bağlantı sürekli)                   |
| Veri Akışı             | İstek-cevap                                | Anlık, iki yönlü                           |
| Önbellekleme           | Kolay                                      | Yok                                        |
| Güvenlik               | TLS/SSL ile (HTTPS)                        | WSS ile (TLS/SSL)                          |
| Kullanım Alanı         | Statik/dinamik içerik, API, dosya          | Gerçek zamanlı uygulamalar                 |
| Ölçeklenebilirlik      | Kolay (stateless)                          | Zor (bağlantı yönetimi gerekir)            |
| Standartlar            | Çok olgun, yaygın                          | Geniş destek, ama ek altyapı gerekebilir   |

---

## ASCII Diyagramlarla Protokol Akışı

### HTTP Akışı
```
İstemci         Sunucu
   |               |
   |--- İstek ---->|
   |               |
   |<-- Cevap ---- |
   |               |
   |--- İstek ---->|
   |               |
   |<-- Cevap ---- |
   |               |
```

### WebSocket Akışı
```
İstemci         Sunucu
   |               |
   |--- HTTP Upgrade (el sıkışma) --->|
   |<-- 101 Switching Protocols ------|
   |               |
   |<===> Gerçek zamanlı çift yönlü ===|
   |               |
   |--- Mesaj ---->|
   |<-- Mesaj ---- |
   |<-- Mesaj ---- |
   |--- Mesaj ---->|
   |               |
```

---

## Avantajlar ve Dezavantajlar

### HTTP Avantajları
- Basit, yaygın ve olgun protokol
- Kolay ölçeklenebilir (stateless)
- Önbellekleme ve proxy desteği
- Standart hata yönetimi ve kimlik doğrulama

### HTTP Dezavantajları
- Her istek için yeni bağlantı (yüksek gecikme)
- Gerçek zamanlı, anlık veri iletimi için uygun değil
- Sunucu istemciye anlık veri gönderemez (push yok)

### WebSocket Avantajları
- Gerçek zamanlı, düşük gecikmeli iletişim
- Çift yönlü ve sürekli bağlantı
- Anlık bildirim, chat, oyun gibi uygulamalarda ideal
- Daha az protokol overhead (başlık vs.)

### WebSocket Dezavantajları
- Sunucuda bağlantı yönetimi karmaşık (stateful)
- Proxy/firewall uyumluluğu sorunlu olabilir
- Standart hata yönetimi ve kimlik doğrulama HTTP kadar olgun değil
- Her uygulama için gereksiz (statik içeriklerde avantajı yok)

---

## Güvenlik ve Ölçeklenebilirlik
- **HTTP:** HTTPS ile veri şifrelenir, stateless olduğu için kolayca yatay ölçeklenir.
- **WebSocket:** WSS ile şifrelenir, ancak sürekli bağlantı nedeniyle sunucu kaynak yönetimi ve ölçeklenebilirlik daha zordur. Bağlantı kopmalarında yeniden bağlanma, kimlik doğrulama ve mesaj bütünlüğü uygulama seviyesinde yönetilmelidir.

---

## Hangi Durumda Hangisi?
- **HTTP:** Statik/dinamik içerik, API, dosya transferi, form gönderimi, önbellekli veri, RESTful servisler.
- **WebSocket:** Chat, canlı skor, oyun, finansal veri, anlık bildirim, IoT, gerçek zamanlı işbirliği.
- **Hibrit:** Modern uygulamalarda genellikle ikisi bir arada kullanılır. Sayfa yükleme ve API için HTTP, gerçek zamanlı özellikler için WebSocket.

---

## Uygulama Mimarisi (ASCII)
```
+-------------------+         WebSocket         +-------------------+
|   Kullanıcı 1     | <----------------------> |                   |
|  (Tarayıcı/Client)|                         |    Sunucu (Node)   |
+-------------------+ <----------------------> |                   |
|   Kullanıcı 2     |         WebSocket        +-------------------+
|  (Tarayıcı/Client)|
+-------------------+
```

---

## Kod Örnekleri

### Sunucu (Node.js)
```js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });
wss.on('connection', ws => {
  ws.send('Hoş geldin!');
  ws.on('message', msg => {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  });
});
```

### İstemci (HTML + JS)
```html
<input id="username" type="text" placeholder="Kullanıcı adınız">
<div id="messages"></div>
<input id="msg" type="text" placeholder="Mesaj yaz...">
<button onclick="sendMsg()">Gönder</button>
<script>
  const ws = new WebSocket('ws://localhost:8080');
  ws.onmessage = (event) => log(event.data);
  function sendMsg() {
    const user = username.value.trim();
    const msg = msgInput.value.trim();
    ws.send(JSON.stringify({ user, msg }));
  }
</script>
```

---

## Sonuç ve Özet
- **HTTP**: Webin temel protokolü, statik/dinamik içerik ve API için ideal, ancak gerçek zamanlı uygulamalarda yetersiz.
- **WebSocket**: Gerçek zamanlı, çift yönlü ve sürekli iletişim gerektiren uygulamalarda vazgeçilmez. Chat, oyun, canlı veri gibi alanlarda büyük avantaj sağlar.
- **Seçim yaparken:** Uygulamanın ihtiyacına göre, çoğu zaman hibrit bir yaklaşım en iyisidir.

---

## Kaynaklar
- [WebSockets vs HTTP: Which to choose for your project in 2024 (ably.com)](https://ably.com/topic/websockets-vs-http)
- [WebSocket vs HTTP (oxylabs.io)](https://oxylabs.io/blog/websocket-vs-http)
- [HTTP/2 vs WebSocket: A Comparative Analysis (thinhdanggroup.github.io)](https://thinhdanggroup.github.io/websocket-vs-http2/)
- [WebSocket vs. HTTPS: Understanding the Differences (medium.com)](https://medium.com/@saranipeiris17/websocket-vs-https-understanding-the-differences-ba7cf3f0ec2e)

---

> Bu doküman, WebSocket ve HTTP protokollerinin farklarını, avantajlarını, kullanım alanlarını ve gerçek zamanlı uygulama geliştirme pratiklerini anlamak isteyenler için kapsamlı bir rehberdir.
