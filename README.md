# ⚔️ Vocab Battle

Game đấu từ vựng Anh–Việt: mỗi lượt có 1 từ tiếng Anh và 4 nghĩa tiếng Việt. Ai trả lời đúng **và nhanh hơn** sẽ gây sát thương cho đối thủ; trả lời đúng liên tiếp tạo combo, sát thương tăng dần. Mỗi bên có 100 HP.

- 3 chế độ: **2 người trên 1 máy** (chia đôi màn hình), **đấu với Bot** (Dễ/Thường/Khó), **Online 1v1** (WebRTC qua PeerJS).
- Màn **Chuẩn bị** trước trận: chọn từ **Bộ có sẵn** hoặc **Bộ của tôi** (nhiều bộ, lọc theo loại), chọn **dạng câu hỏi**, xem trước bằng flashcard. Kết quả liệt kê từ/cụm từ trả lời sai và cập nhật lịch ôn.
- **Bộ từ của tôi**: từ đơn và cụm từ (collocation, phrasal verb, idiom, mẫu câu), đăng nhập GitHub/Microsoft để lưu lên Cosmos DB (chưa đăng nhập thì lưu IndexedDB trên máy), nhập/xuất/chia sẻ, tạo bộ bằng AI.
- **Ôn tập ngắt quãng FSRS**: flashcard EN→VI, VI→EN, Cloze, Nghe; trang **Ôn hôm nay** và thống kê.
- **AI hỗ trợ học:** từ điển AI (IPA, nghĩa theo từng nghĩa, CEFR, ví dụ có dịch, collocations, đồng/trái nghĩa, lỗi người Việt hay mắc) và **gia sư chat** (Free talk / Sửa lỗi / Giải thích / Luyện từ đã chọn).

Hosting: **Azure Static Web Apps (gói Free)**. Frontend Vite + React + TypeScript, API là **Azure Functions .NET 10 isolated** (managed functions) trong `api/`, gọi qua đường dẫn tương đối `/api/...` (cùng origin, không cần CORS).

## ⌨️ Luyện Gõ

Thẻ từ/cụm từ rơi xuống trên nền không gian; gõ đúng để bắn hạ trước khi chạm vạch đáy (3 tim).

- **Kiểu nội dung**: Gõ lại (thẻ hiện từ tiếng Anh) · Nghĩa → Anh (thẻ hiện nghĩa) · Nghe (thẻ ẩn chữ, tự đọc; Tab hoặc chạm thẻ để nghe lại) · Cloze (câu ví dụ che cụm từ; mục không có ví dụ phù hợp thì hỏi nghĩa).
- **Điều khiển**: gõ ký tự đầu để ngắm thẻ phù hợp gần đáy nhất; Backspace xoá, Esc bỏ ngắm; giữ `?` 1 giây (hoặc 💡) để lộ ký tự kế tiếp (−15 điểm). Không phân biệt hoa thường, cụm từ phải gõ đúng dấu cách. Hãy tắt bộ gõ tiếng Việt (app nhắc khi phát hiện Telex/VNI và tự bỏ dấu).
- **20 mốc** (4 thẻ/mốc): qua mốc thì thẻ rơi nhanh hơn và nhiều hơn. Gõ sai mất combo.
- **Chế độ**: Một mình (kỷ lục theo bộ từ + kiểu nội dung) · Đấu Bot (Dễ 22 / Thường 38 / Khó 58 WPM, sân Bot thu nhỏ bên cạnh) · Online 1v1 (chủ phòng chọn "⌨️ Luyện Gõ" ở bước chọn từ). Combo 5 gửi 1 thẻ tấn công (viền đỏ, rơi nhanh) sang đối thủ, combo 10 gửi 2. Luật: hết tim thì thua, hoặc **Đua mốc 20**. 2 người 1 bàn phím không hỗ trợ.
- **Online**: cùng seed nên hai bên có cùng chuỗi từ rơi; mỗi bên gửi trạng thái tối giản ~5 lần/giây (`typingStatus`); chủ phòng giới hạn tần suất tấn công của khách và quyết định thắng/thua (`typingOver`).
- **Kết quả**: điểm, mốc, WPM, độ chính xác, combo; danh sách từ gõ sai/để lọt với nút ôn bằng flashcard và hỏi AI. FSRS: gõ đúng ngay = Good, có sai/gợi ý = Hard, để lọt = Again (thẻ theo kiểu nội dung: Nghĩa → Anh = VI→EN, Nghe = Nghe, Cloze = Cloze, Gõ lại = EN→VI). Lịch sử phiên lưu trong progress `_typing` (100 phiên gần nhất) và hiện ở trang Ôn hôm nay.
- **Kỹ thuật**: logic thuần, có seed trong `src/typing/engine.ts`; Canvas 2D + requestAnimationFrame với fixed timestep 1/60 s, thẻ và hiệu ứng dùng pool; React chỉ vẽ HUD qua store zustand; âm thanh Web Audio (nhớ tắt/bật); tự tạm dừng khi ẩn tab (online chỉ cảnh báo); hiệu ứng giảm khi bật reduced motion.

## ✍️ Luyện Writing VSTEP

Viết bài có tính giờ, AI chấm theo 4 tiêu chí VSTEP, tô lỗi ngay trong bài, đưa bản viết lại tham khảo và gợi ý cụm từ hay để thêm vào bộ từ.

- **Chế độ**: luyện Task 1 (thư/email, ≥ 120 từ, gợi ý 20 phút) hoặc Task 2 (bài luận, ≥ 250 từ, 40 phút), hoặc **Thi thử** (cả 2 task, chung 60 phút, chuyển qua lại tuỳ ý, hết giờ tự nộp, không dán được văn bản). Bậc mục tiêu B1 / B2 / C1 ảnh hưởng độ khó đề và văn phong bản viết lại.
- **Đề**: AI ra đề đúng format VSTEP theo chủ đề (hoặc ngẫu nhiên) và dạng bài Task 2; hoặc tự dán đề. Không nhúng sẵn đề thi thật hay đề sách có bản quyền. 30 đề gần nhất được nhớ trên máy và gửi cho AI như danh sách "không lặp lại".
- **Màn viết**: đề bên trái (thu gọn được), ô văn bản thuần bên phải; tắt spellcheck/autocorrect như thi thật (luyện tập có thể bật lại). Đếm từ realtime, đồng hồ cảnh báo khi còn 5 phút và 1 phút. Nháp tự lưu mỗi 5 giây vào IndexedDB (kèm deadline) và được đề nghị khôi phục khi mở lại.
- **Chấm**: `POST /api/writing/grade` chạy song song 3 lời gọi structured output (điểm + nhận xét, danh sách lỗi, bản viết lại + cụm từ) để nằm trong giới hạn khoảng 45 giây của SWA; phần lỗi hoặc bản viết lại chưa xong trước `AI_GRADING_TIMEOUT_SECONDS` thì vẫn trả điểm kèm thông báo. Server tính lại điểm task = trung bình 4 tiêu chí (làm tròn 0.5), không tin con số tổng của AI. Bài ngắn hơn mức tối thiểu bị giới hạn điểm Hoàn thành nhiệm vụ theo tỉ lệ độ dài. Thi thử: điểm Writing = (Task 1 + Task 2 × 2) / 3. Điểm chỉ là ước lượng của AI để luyện tập.
- **Kết quả**: biểu đồ điểm theo tiêu chí; lỗi được tô theo loại trong bài (màu + kiểu gạch chân + nhãn chữ, có bộ lọc); bấm/rê vào lỗi để xem bản sửa, giải thích và "Hỏi AI về lỗi này". Lỗi không định vị được nằm ở danh sách "lỗi chung". Có tab bản viết lại song song (tô chỗ khác biệt), tab cụm từ hay (thêm vào bộ "VSTEP Writing – <chủ đề>" để học bằng flashcard/battle/Luyện Gõ), nút "Viết lại bài này" và bảng so sánh điểm giữa các lần làm cùng đề.
- **Lịch sử**: lọc theo task/chủ đề, biểu đồ 4 tiêu chí theo thời gian, thống kê lỗi theo loại và lỗi lặp lại (mạo từ, thì, giới từ…). Đăng nhập thì lưu trong container Cosmos `writings` (mỗi bài một document, một document `index` cho tóm tắt, tổng lỗi và quota); chưa đăng nhập thì lưu IndexedDB.

**Thông số đề thi** (số từ, thời gian, trọng số, làm tròn, quy đổi bậc: dưới 4.0 chưa đạt, 4.0–5.5 B1, 6.0–8.0 B2, 8.5–10 C1) nằm duy nhất trong [`api/Shared/vstep.json`](api/Shared/vstep.json), frontend (`src/vstep/config.ts`) và API (`api/Core/Writing/VstepConfig.cs`) cùng đọc file này. **Cần đối chiếu với hướng dẫn chính thức của kỳ thi**; muốn đổi chỉ cần sửa file đó.

### Độ ổn định của điểm

`fixtures/vstep/` có 3 bài mẫu tự soạn (yếu / trung bình / tốt) cho cùng một đề Task 2. Chấm mỗi bài 3 lần để xem điểm dao động bao nhiêu:

```bash
BASE=https://<site>.azurestaticapps.net RUNS=3 node scripts/grade-fixtures.mjs
```

Kết quả: _chưa chạy – chạy sau khi đặt `AI_GRADING_MODEL` trên SWA._

## Loại mục, kiểu thẻ, dạng câu hỏi

**Loại mục** (`type`): `word` (từ đơn), `collocation` (vd *make a decision*), `phrasal_verb` (vd *look into*), `idiom` (vd *break the ice*), `pattern` (mẫu câu, vd *It's no use + V-ing*). Mỗi mục có `text`, `meaning`, tối đa 5 ví dụ `{en, vi}`, `ipa`/`partOfSpeech`/`note` tuỳ chọn, `tags`, `relatedTo` (mục gốc) và `distractors` (đáp án nhiễu do AI sinh sẵn khi lưu cụm từ, để battle không phải gọi AI). Giới hạn: 50 bộ/tài khoản, 500 mục/bộ.

**Kiểu thẻ** (học): EN → VI · VI → EN (tự nhớ hoặc gõ đáp án) · Cloze (che cụm từ trong câu ví dụ, chỉ tạo khi ví dụ chứa cụm từ, kể cả dạng chia *looked into*) · Nghe (Web Speech API đọc, đoán từ). Mỗi phiên chọn một kiểu hoặc **Trộn**.

**Phím tắt**: `Space` lật thẻ · `1`–`4` = Again / Hard / Good / Easy · Enter để kiểm tra khi gõ đáp án. Điện thoại: chạm để lật, vuốt trái = Again, vuốt phải = Good. Hiệu ứng lật tắt khi bật *reduced motion*. Battle: người dưới `1`–`4`, người trên `7`–`0`.

**FSRS tóm tắt**: mỗi thẻ (itemId + kiểu thẻ) có độ ổn định (stability) và độ khó (difficulty). Mỗi lần chấm, [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) tính ngày ôn tiếp theo sao cho xác suất còn nhớ khoảng 90%: Again đưa thẻ về ôn sau vài phút, Good/Easy giãn khoảng cách ngày càng xa. "Ôn hôm nay" gom thẻ đến hạn của mọi bộ (quá hạn lâu và hay quên được ưu tiên), cộng thẻ mới, theo giới hạn mỗi ngày trong ⚙️ Cài đặt (mặc định 20 thẻ mới, 200 lượt ôn). Tiến độ ghi theo lô (mỗi 10 thẻ và cuối phiên); mất mạng thì xếp hàng trong IndexedDB rồi gửi lại. Kết quả battle cũng cập nhật thẻ EN→VI: sai = Again, đúng = Good.

**Dạng câu hỏi battle** (cùng luật HP/damage/combo, mỗi dạng là một `QuestionGenerator` trong `src/game/generators.ts`):

| Dạng | Ví dụ | Cần |
| --- | --- | --- |
| Nghĩa | *break the ice* → chọn nghĩa | mọi mục |
| Điền chỗ trống | *The police ___ the case.* → looked into | ví dụ chứa cụm từ |
| Ghép collocation | *___ a decision* → make / do / take / have | collocation có ≥ 3 cụm sai do AI sinh |
| Tiểu từ phrasal verb | *look ___ the problem* → into / at / after / up | phrasal verb |
| Tìm câu dùng sai | 4 câu, chọn câu sai (*I did a decision*) | có câu sai do AI sinh |
| Idiom theo tình huống | tình huống tiếng Việt → chọn idiom | idiom có ví dụ dịch |

Mục không đủ dữ liệu cho dạng được chọn sẽ hỏi Nghĩa hoặc Cloze. Đáp án nhiễu ưu tiên mục cùng loại; bộ nhỏ (dưới 4 mục) lấy thêm từ `words.json`. Sau mỗi câu có giải thích ngắn (bấm **Bỏ qua** để đi tiếp). Chọn toàn mục từ bộ của mình thì không cần đủ 10 mục.

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

Chạy kèm **Cosmos DB Emulator** ([cài đặt](https://learn.microsoft.com/azure/cosmos-db/emulator)): tạo database `vocabbattle` và 3 container như phần Deploy, rồi đặt `COSMOS_CONNECTION_STRING` (connection string của emulator) trong `api/local.settings.json`. SWA CLI giả lập đăng nhập tại `/.auth/login/github`. Integration test chạy khi có biến môi trường:

```bash
COSMOS_EMULATOR_CONNECTION_STRING="AccountEndpoint=https://localhost:8081/;AccountKey=<key emulator>" dotnet test --project api.Tests
```

(Không có biến này, test đó tự skip, ví dụ trên CI.)

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
| `CHAT_STREAMING` | không | Mặc định trả lời chat một lần (JSON); `true` để stream SSE (xem bên dưới) |
| `RATE_LOOKUP_PER_MINUTE` / `RATE_CHAT_PER_MINUTE` / `RATE_GENERATE_PER_MINUTE` / `RATE_PER_IP_PER_DAY` | không | Mặc định 20 / 10 / 10 / 300 |
| `AI_GENERATE_MAX_TOKENS` | không | Tạo bộ / trích từ đoạn văn, mặc định 4000 |
| `COSMOS_CONNECTION_STRING` | cho "Bộ từ của tôi" | Connection string của Cosmos DB; thiếu thì API dữ liệu trả 503, AI vẫn chạy |
| `COSMOS_DATABASE` | không | Mặc định `vocabbattle` |
| `RATE_DATA_PER_MINUTE` / `RATE_DATA_PER_DAY` | không | Giới hạn API dữ liệu theo tài khoản, mặc định 60 / 3000 |
| `AI_GRADING_MODEL` | nên có | Model chấm Writing VSTEP (có thể mạnh hơn model tra từ); mặc định dùng `AI_MODEL`. Cùng provider với `AI_PROVIDER` |
| `AI_GRADING_PRICE_INPUT_PER_MTOK` / `AI_GRADING_PRICE_OUTPUT_PER_MTOK` | nên có | Đơn giá của model chấm (mặc định lấy đơn giá chính) để log chi phí đúng |
| `AI_GRADING_EFFORT` | không | Mức suy luận khi chấm; mặc định như `AI_EFFORT` |
| `AI_GRADING_TEMPERATURE` | không | Chỉ gửi khi đặt. Claude và các model reasoning của OpenAI hiện **từ chối** tham số `temperature`, nên mặc định không gửi; độ ổn định đến từ rubric cố định + effort |
| `AI_GRADING_MAX_TOKENS` | không | Mỗi lời gọi chấm (3 lời gọi song song), mặc định 6000 |
| `AI_GRADING_TIMEOUT_SECONDS` | không | Hạn chót phía server cho một lần chấm, mặc định 38 (SWA cắt request ở khoảng 45 giây) |
| `RATE_WRITING_GRADE_PER_DAY` / `RATE_WRITING_GRADE_PER_DAY_ANON` | không | Số lần chấm bài mỗi ngày: theo tài khoản (đếm trong Cosmos) / theo IP khi chưa đăng nhập (đếm trong bộ nhớ). Mặc định 10 / 3 |

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
| `POST /api/generate-deck` `{ topic, level, count }` | Tạo bộ 10–30 mục theo chủ đề. |
| `POST /api/suggest-phrases` `{ word }` | 5–10 collocation / phrasal verb / idiom chứa từ. |
| `POST /api/extract-items` `{ passage, level }` | Từ & cụm từ đáng học trong đoạn văn (≤ 2000 ký tự). |
| `POST /api/generate-distractors` `{ items: [{type, text, meaning}] }` | Đáp án nhiễu cho battle, tối đa 10 mục/lần. |
| `GET/POST /api/decks`, `GET/PUT/DELETE /api/decks/{id}` | Bộ từ của người đăng nhập. PUT cần `If-Match` (etag); lệch etag → 412 kèm bản hiện tại để chọn giữ bản nào. |
| `GET/PUT /api/progress/{deckId}` | Tiến độ FSRS; PUT gửi một lô và được merge (thẻ mới hơn thắng, cộng bộ đếm ngày). |
| `POST /api/shares` `{ deckId }`, `GET /api/shares/{code}` | Mã chia sẻ 8 ký tự (30 ngày). GET không cần đăng nhập. |
| `POST /api/writing/generate-prompt` `{ task, level, topic, essayType, avoid }` | Đề VSTEP do AI soạn (`topic: "random"` để server chọn). |
| `POST /api/writing/grade` `{ task, level, prompt, essay, durationSec, examId? }` | Chấm bài (≤ 600 từ). Có giới hạn số lần/ngày riêng; đăng nhập thì lưu luôn vào lịch sử và trả `saved: { id, promptId, attempt }`. |
| `GET /api/writings`, `GET/DELETE /api/writings/{id}` | Lịch sử Writing (tóm tắt + thống kê lỗi) và từng bài, chỉ của người đăng nhập. |
| `GET /api/usage` | Số request, token vào/ra, chi phí ước tính và **RU Cosmos** trong ngày (UTC). |

Mọi endpoint AI dùng structured output và validate bằng chính schema đã gửi (`api/AiShared/*.schema.json`), retry 1 lần, tính vào rate limit. Kết quả AI luôn qua màn xem trước để chọn trước khi lưu.

Endpoint dữ liệu đọc user từ header `x-ms-client-principal` do SWA đặt (không tin `userId` client gửi), mọi truy vấn chỉ trong partition của user đó. `staticwebapp.config.json` yêu cầu role `authenticated` cho `/api/decks*`, `/api/progress/*`, `/api/writings*` và `POST /api/shares`.

System prompt và schema nằm trong `api/AiShared/`. Server nhúng chúng vào build, còn frontend (chế độ BYOK) import trực tiếp, nên hai bên luôn dùng chung một bản.

### Bảo vệ chi phí

- `max_tokens` có giới hạn. Từ tra cứu tối đa 40 ký tự. Mỗi tin nhắn chat tối đa 1000 ký tự. Chỉ gửi 20 tin nhắn gần nhất (tổng ≤ 8000 ký tự).
- Rate limit theo IP (lấy từ `X-Forwarded-For`): 20 lần tra/phút, 10 tin nhắn chat/phút, 300 yêu cầu/ngày. Vượt giới hạn sẽ nhận **429** kèm `Retry-After` và thông báo tiếng Việt để hiển thị.
- Mỗi request đều ghi log số token vào/ra và chi phí ước tính. Tuỳ chọn `AI_DAILY_BUDGET_USD` để chặn khi vượt ngân sách.
- **Hạn chế:** rate limit, thống kê `/api/usage` và ngân sách đều lưu **trong bộ nhớ**. Chúng reset khi Functions cold start, và nếu Azure chạy nhiều instance thì mỗi instance đếm riêng (giới hạn thực tế có thể cao hơn). Muốn chặt chẽ hơn thì chuyển bộ đếm sang Azure Table Storage hoặc Redis.

### Streaming trên SWA

**Kết quả đo ngày 23/10/2026 trên SWA Free (East US 2, .NET 10 isolated + ASP.NET Core integration):** managed functions **buffer toàn bộ response**. Với `CHAT_STREAMING=true`, server ghi SSE và flush từng đoạn, nhưng client vẫn nhận toàn bộ câu trả lời (khoảng 2 KB) trong **một chunk** sau khoảng 3,1 giây; không có chunk nào đến trước.

Vì vậy mặc định chat **trả về một lần** (JSON `{ "reply": … }`), còn UI hiển thị "AI đang trả lời…" trong lúc chờ. Code streaming vẫn được giữ: client đọc được cả SSE lẫn JSON, nên nếu sau này chuyển API sang Function App riêng (không qua proxy của SWA) thì chỉ cần đặt `CHAT_STREAMING=true`. Chế độ BYOK gọi thẳng provider nên vẫn stream thật.

## BYOK (API key riêng)

⚙️ **Cài đặt** cho phép chọn OpenAI hoặc Anthropic, nhập key và model. Key **chỉ lưu trong trình duyệt** (localStorage), nên chỉ dùng trên máy cá nhân. Khi có key, app gọi thẳng provider từ trình duyệt (Anthropic qua SDK chính thức với `dangerouslyAllowBrowser`, SDK tự thêm header `anthropic-dangerous-direct-browser-access: true`), dùng chung system prompt và schema với server. UI chỉ biết interface `AiClient` (`ServerAiClient` / `DirectAiClient`), không phụ thuộc vào cách gọi.

## Thêm từ vựng

Sửa `src/data/words.json`, mỗi từ có dạng:

```json
{ "id": "harvest", "word": "harvest", "meaning": "thu hoạch", "example": "Farmers harvest rice in autumn.", "level": "B1" }
```

`id` và `meaning` phải là duy nhất (test `src/data/words.test.ts` sẽ kiểm tra). `level` là một trong `A1`, `A2`, `B1`, `B2`. Người chơi tự thêm từ/cụm từ trong **Bộ từ của tôi** (danh sách "Của tôi" cũ được chuyển thành bộ tên "Của tôi").

Nhập: dán dòng `word - nghĩa` hoặc CSV `word,meaning,example`; xuất JSON/CSV. Chia sẻ: đã đăng nhập thì link ngắn `?share=CODE`; chưa đăng nhập thì cả bộ được nén (lz-string) vào `?deck=…` (cảnh báo khi quá 8000 ký tự).

## Chơi online

1. Người A chọn **Online 1v1 → Tạo phòng**, rồi gửi mã 6 ký tự hoặc bấm **Copy link mời** (`…/?room=ABC123`).
2. Người B mở link hoặc nhập mã rồi bấm **Vào phòng**.
3. Chủ phòng chọn bộ từ và dạng câu hỏi (gửi kèm toàn bộ nội dung mục, có giới hạn kích thước, nên bộ của chủ phòng dùng được ngay). Sau trận, khách có nút **Lưu bộ này**. Hai bên xem trước rồi bấm **Sẵn sàng**, sau đó đếm ngược 3-2-1 và vào trận.

Nếu không kết nối được sau 15 giây, hãy thử mạng khác (ví dụ 4G), vì một số mạng chặn WebRTC.

## Deploy (Azure Static Web Apps)

Workflow `.github/workflows/azure-static-web-apps.yml` chạy khi push vào `main`: `npm test`, rồi `dotnet test`, rồi `Azure/static-web-apps-deploy` (`app_location: /`, `api_location: api`, `output_location: dist`). `public/staticwebapp.config.json` cấu hình SPA fallback, runtime `dotnet-isolated:10.0`, và chỉ cho phép các method cần thiết trên `/api`.

> Dùng .NET 10 vì theo [bảng runtime của SWA](https://learn.microsoft.com/azure/static-web-apps/languages-runtimes), `dotnet-isolated:8.0` hết hỗ trợ ngày 10/11/2026.

Thiết lập một lần (trên web):

1. **Azure Portal → Static Web Apps → Create**: Plan **Free**, **Deployment source: Other** (repo đã có workflow riêng), region **East US 2** (hoặc West Europe / West US 2 / Central US).
   ⚠️ **Không chọn East Asia**: managed functions khi đó chạy ở Hong Kong, nơi OpenAI và Anthropic không phục vụ (lỗi `unsupported_country_region_territory`, HTTP 403). Region không đổi được sau khi tạo.
2. **Overview → Manage deployment token**, copy token rồi thêm vào **GitHub → Settings → Secrets and variables → Actions** với tên `AZURE_STATIC_WEB_APPS_API_TOKEN`.
3. **Settings → Environment variables** (tab Production): thêm `AI_PROVIDER`, `AI_MODEL`, `OPENAI_API_KEY`, `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK` (xem bảng ở trên) rồi bấm **Apply**.

### Cosmos DB (Bộ từ của tôi) – giữ trong gói miễn phí

- Tạo account **Azure Cosmos DB for NoSQL** với **Apply Free Tier Discount** (mỗi subscription chỉ 1 account free tier: 1000 RU/s và 25 GB miễn phí).
- Database `vocabbattle` dùng **throughput chia sẻ, Manual 1000 RU/s** (không đặt throughput riêng cho container, không autoscale), nên không bao giờ vượt phần miễn phí.
- Container: `decks` (partition `/userId`), `progress` (`/userId`), `shares` (`/code`, bật TTL "On (no default)"; mỗi share tự đặt `ttl` 30 ngày), `writings` (`/userId`).
- Indexing policy chỉ index trường được truy vấn, loại trừ `items` / thẻ để ghi rẻ RU:
  - `decks`: include `/userId/?`, `/updatedAt/?`, `/name/?`; exclude `/*`.
  - `progress`, `shares`, `writings`: exclude `/*` (chỉ đọc theo id).
- Mỗi request log RU; xem tổng trong `GET /api/usage` → `ru`.
- Chỉ có thể dùng connection string (managed functions của SWA không hỗ trợ managed identity), đặt trong Environment variables, không commit.

### Trước khi deploy thay đổi dữ liệu: backup

```bash
COSMOS_CONNECTION_STRING="<connection string, chỉ dán trong terminal của bạn>" npm run backup:cosmos
```

Script ghi `backups/<thời điểm>/decks.json`, `progress.json` và `writings.json` (thư mục đã gitignore). Migration `words[]` → `items[]` (schemaVersion 2) chạy khi đọc và được ghi lại ở dạng mới trong lần lưu kế tiếp, ở cả API lẫn IndexedDB (Dexie version 2).

## Kiến trúc

- `src/game/`: game logic thuần (damage, combo, chọn câu hỏi, engine) và `Match`, dùng chung cho cả 3 chế độ. `src/controllers/`: Bot.
- `src/net/`: `protocol.ts`, `GameTransport` (interface), `peerTransport.ts` (PeerJS), `host.ts` (authoritative), `guest.ts`.
- `src/ai/`: `AiClient` + 2 implementation, cắt lịch sử chat, cache tra từ, bộ "Của tôi". `src/components/ai/`: header, từ điển, chat, cài đặt.
- `src/decks/`: model `Item`/`Deck`, migration, `DeckRepository` (`CloudDeckRepository` / `LocalDeckRepository` Dexie), đồng bộ local → cloud, import/export/chia sẻ. `src/study/`: FSRS, cloze, hàng đợi ôn, ghi tiến độ theo lô.
- `api/Core/Data/`: `ClientPrincipal`, `IDocumentStore` (Cosmos / in-memory trong test), `DeckService`, `ProgressService`, `ShareService`, FluentValidation.
- `api/Core/`: logic thuần, test được (`IAiProvider` với `OpenAiProvider`/`AnthropicProvider`, `LookupService`, `ChatService`, rate limit, usage). `api/Functions/` chỉ gồm các HTTP trigger mỏng. `api.Tests/`: xUnit với HttpClient được mock.
