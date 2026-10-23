# ⚔️ Vocab Battle

Game đấu từ vựng Anh–Việt: mỗi lượt có 1 từ tiếng Anh và 4 nghĩa tiếng Việt. Ai trả lời đúng **và nhanh hơn** sẽ gây sát thương cho đối thủ; trả lời đúng liên tiếp tạo combo, sát thương tăng dần. Mỗi bên có 100 HP.

- 3 chế độ: **2 người trên 1 máy** (chia đôi màn hình), **đấu với Bot** (Dễ/Thường/Khó), **Online 1v1** (WebRTC qua PeerJS).
- Màn **Chuẩn bị** trước trận: chọn bộ từ (tối thiểu 10), xem trước bằng flashcard. Kết quả liệt kê từ trả lời sai để ôn lại.
- **AI hỗ trợ học:** từ điển AI (IPA, nghĩa theo từng nghĩa, CEFR, ví dụ có dịch, collocations, đồng/trái nghĩa, lỗi người Việt hay mắc) và **gia sư chat** (Free talk / Sửa lỗi / Giải thích / Luyện từ đã chọn).

Hosting: **Azure Static Web Apps (gói Free)**. Frontend Vite + React + TypeScript, API là **Azure Functions .NET 10 isolated** (managed functions) trong `api/`, gọi qua đường dẫn tương đối `/api/...` (cùng origin, không cần CORS).

## Chạy local

```bash
npm install
npm run dev                      # frontend: http://localhost:5173 (chưa có /api)
npm test                         # Vitest
npm run build                    # build ra dist/
dotnet test --project api.Tests  # xUnit cho API (.NET 10 SDK)
```

Chạy cả frontend + API cùng origin bằng [SWA CLI](https://learn.microsoft.com/azure/static-web-apps/static-web-apps-cli-overview) (cần Azure Functions Core Tools v4):

```bash
cp api/local.settings.sample.json api/local.settings.json   # rồi điền OPENAI_API_KEY (file này đã được gitignore)
npx @azure/static-web-apps-cli start http://localhost:5173 --run "npm run dev" --api-location api
```

Không có API local? Mở ⚙️ **Cài đặt** và nhập API key riêng (BYOK): app sẽ gọi thẳng OpenAI/Anthropic từ trình duyệt.

## Cấu hình AI (Application settings của SWA)

Mọi key và lựa chọn model nằm trong **Application settings** của Static Web App, không có trong repo.

| Setting | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `AI_PROVIDER` | có | `openai` (mặc định) hoặc `anthropic` |
| `AI_MODEL` | có | Model ID, ví dụ `gpt-6-luna` hoặc `claude-haiku-5-5` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | theo provider | Key của provider đang dùng |
| `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK` | nên có | Đơn giá USD / 1 triệu token, dùng để ước tính chi phí |
| `AI_DAILY_BUDGET_USD` | không | Ngân sách ước tính mỗi ngày; vượt thì trả 429 |
| `AI_LOOKUP_MAX_TOKENS` / `AI_CHAT_MAX_TOKENS` | không | Mặc định 1500 / 800 |
| `AI_EFFORT` | không | Mức suy luận; mặc định `none` (OpenAI), `low` (Anthropic) |
| `CHAT_STREAMING` | không | `false` để trả lời chat một lần thay vì stream |
| `RATE_LOOKUP_PER_MINUTE` / `RATE_CHAT_PER_MINUTE` / `RATE_PER_IP_PER_DAY` | không | Mặc định 20 / 10 / 300 |

### Chọn model

Tra cứu ngày 23/10/2026 trên trang chính thức của OpenAI ([Models](https://developers.openai.com/api/docs/models), [Pricing](https://developers.openai.com/api/docs/pricing), [Deprecations](https://developers.openai.com/api/docs/deprecations)):

- **Mặc định: `gpt-6-luna`** ($0.10 vào / $0.50 ra mỗi 1M token). OpenAI mô tả đây là model "most efficient… for focused, high-volume tasks". Model này không bị deprecated, hỗ trợ Structured Outputs và streaming, và chạy với `reasoning.effort: "none"` nên không tốn token suy luận. Tra từ và chat ngắn đúng là loại việc này.
- Họ nano/mini cũ đều đã bị deprecated: `gpt-5-nano` ($0.05/$0.40, rẻ hơn nhưng tắt ngày 11/12/2026), `gpt-5.4-nano` ($0.20/$1.25, tắt ngày 01/04/2027), `gpt-4.1-nano` (đã tắt). Chọn các model này thì sẽ phải đổi lại sớm.
- Với `AI_PROVIDER=anthropic`, khuyến nghị **`claude-haiku-5-5`** ($0.10 / $0.50, cùng mức giá). API không gửi `thinking`/`temperature`, dùng `output_config.effort: "low"` và structured output `output_config.format`.

Ví dụ chi phí: một lần tra từ khoảng 700 token vào + 600 token ra, tức khoảng $0.0004. 1.000 lần tra từ tốn khoảng $0.40.

## API

| Endpoint | Mô tả |
| --- | --- |
| `POST /api/lookup` `{ "word": "resilient" }` | Tra từ. Dùng structured output (JSON schema) của provider, validate lại bằng **cùng schema** (`api/AiShared/lookup.schema.json`); lỗi parse/validate thì retry 1 lần. |
| `POST /api/chat` `{ mode, level?, words?, messages }` | Chat có streaming (SSE `data: {"delta": …}`). System prompt do server chọn theo `mode`; client không gửi được system prompt hay model. |
| `GET /api/usage` | Số request, token vào/ra và chi phí ước tính trong ngày (UTC), chia theo endpoint. |

System prompt và schema nằm trong `api/AiShared/`. Server nhúng chúng vào build, còn frontend (chế độ BYOK) import trực tiếp, nên hai bên luôn dùng chung một bản.

### Bảo vệ chi phí

- `max_tokens` có giới hạn. Từ tra cứu tối đa 40 ký tự. Mỗi tin nhắn chat tối đa 1000 ký tự. Chỉ gửi 20 tin nhắn gần nhất (tổng ≤ 8000 ký tự).
- Rate limit theo IP (lấy từ `X-Forwarded-For`): 20 lần tra/phút, 10 tin nhắn chat/phút, 300 yêu cầu/ngày. Vượt giới hạn sẽ nhận **429** kèm `Retry-After` và thông báo tiếng Việt để hiển thị.
- Mỗi request đều ghi log số token vào/ra và chi phí ước tính. Tuỳ chọn `AI_DAILY_BUDGET_USD` để chặn khi vượt ngân sách.
- **Hạn chế:** rate limit, thống kê `/api/usage` và ngân sách đều lưu **trong bộ nhớ**. Chúng reset khi Functions cold start, và nếu Azure chạy nhiều instance thì mỗi instance đếm riêng (giới hạn thực tế có thể cao hơn). Muốn chặt chẽ hơn thì chuyển bộ đếm sang Azure Table Storage hoặc Redis.

### Streaming trên SWA

Kết quả thử nghiệm trên SWA thật: _(sẽ cập nhật sau lần deploy đầu)_. Nếu managed functions buffer response, client vẫn chạy được: hiển thị "AI đang trả lời…" rồi nhận toàn bộ câu trả lời một lần. Có thể đặt `CHAT_STREAMING=false` để server trả JSON một lần.

## BYOK (API key riêng)

⚙️ **Cài đặt** cho phép chọn OpenAI hoặc Anthropic, nhập key và model. Key **chỉ lưu trong trình duyệt** (localStorage), nên chỉ dùng trên máy cá nhân. Khi có key, app gọi thẳng provider từ trình duyệt (Anthropic qua SDK chính thức với `dangerouslyAllowBrowser`, SDK tự thêm header `anthropic-dangerous-direct-browser-access: true`), dùng chung system prompt và schema với server. UI chỉ biết interface `AiClient` (`ServerAiClient` / `DirectAiClient`), không phụ thuộc vào cách gọi.

## Thêm từ vựng

Sửa `src/data/words.json`, mỗi từ có dạng:

```json
{ "id": "harvest", "word": "harvest", "meaning": "thu hoạch", "example": "Farmers harvest rice in autumn.", "level": "B1" }
```

`id` và `meaning` phải là duy nhất (test `src/data/words.test.ts` sẽ kiểm tra). `level` là một trong `A1`, `A2`, `B1`, `B2`. Ngoài ra, người chơi có thể tự thêm từ qua từ điển AI (bộ "Của tôi").

## Chơi online

1. Người A chọn **Online 1v1 → Tạo phòng**, rồi gửi mã 6 ký tự hoặc bấm **Copy link mời** (`…/?room=ABC123`).
2. Người B mở link hoặc nhập mã rồi bấm **Vào phòng**.
3. Chủ phòng chọn bộ từ (gửi kèm nội dung từ, nên từ "Của tôi" của chủ phòng cũng dùng được). Hai bên xem trước rồi bấm **Sẵn sàng**, sau đó đếm ngược 3-2-1 và vào trận.

Nếu không kết nối được sau 15 giây, hãy thử mạng khác (ví dụ 4G), vì một số mạng chặn WebRTC.

## Deploy (Azure Static Web Apps)

Workflow `.github/workflows/azure-static-web-apps.yml` chạy khi push vào `main`: `npm test`, rồi `dotnet test`, rồi `Azure/static-web-apps-deploy` (`app_location: /`, `api_location: api`, `output_location: dist`). `public/staticwebapp.config.json` cấu hình SPA fallback, runtime `dotnet-isolated:10.0`, và chỉ cho phép các method cần thiết trên `/api`.

> Dùng .NET 10 vì theo [bảng runtime của SWA](https://learn.microsoft.com/azure/static-web-apps/languages-runtimes), `dotnet-isolated:8.0` hết hỗ trợ ngày 10/11/2026.

Thiết lập một lần (trên web):

1. **Azure Portal → Static Web Apps → Create**: Plan **Free**, region East Asia, **Deployment source: Other** (repo đã có workflow riêng).
2. **Overview → Manage deployment token**, copy token rồi thêm vào **GitHub → Settings → Secrets and variables → Actions** với tên `AZURE_STATIC_WEB_APPS_API_TOKEN`.
3. **Settings → Environment variables** (tab Production): thêm `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY`, `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK` (xem bảng ở trên) rồi bấm **Apply**.

## Kiến trúc

- `src/game/`: game logic thuần (damage, combo, chọn câu hỏi, engine) và `Match`, dùng chung cho cả 3 chế độ. `src/controllers/`: Bot.
- `src/net/`: `protocol.ts`, `GameTransport` (interface), `peerTransport.ts` (PeerJS), `host.ts` (authoritative), `guest.ts`.
- `src/ai/`: `AiClient` + 2 implementation, cắt lịch sử chat, cache tra từ, bộ "Của tôi". `src/components/ai/`: header, từ điển, chat, cài đặt.
- `api/Core/`: logic thuần, test được (`IAiProvider` với `OpenAiProvider`/`AnthropicProvider`, `LookupService`, `ChatService`, rate limit, usage). `api/Functions/` chỉ gồm các HTTP trigger mỏng. `api.Tests/`: xUnit với HttpClient được mock.
