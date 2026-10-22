# ⚔️ Vocab Battle

Game đấu từ vựng Anh–Việt: mỗi lượt có 1 từ tiếng Anh và 4 nghĩa tiếng Việt. Ai trả lời đúng **và nhanh hơn** sẽ gây sát thương cho đối thủ; trả lời đúng liên tiếp tạo combo, sát thương tăng dần. Mỗi bên có 100 HP.

Có 3 chế độ: **2 người trên 1 máy** (chia đôi màn hình), **đấu với Bot** (Dễ/Thường/Khó) và **Online 1v1** (WebRTC qua PeerJS, không cần backend). Trước mỗi trận đều có bước **Chuẩn bị**: chọn bộ từ (tối thiểu 10 từ) rồi xem trước bằng flashcard. Màn hình kết quả liệt kê các từ trả lời sai để ôn lại.

## Chạy local

```bash
npm install
npm run dev      # http://localhost:5173/vocab-battle/
npm test         # unit test (Vitest)
npm run build    # build ra dist/
```

## Thêm từ vựng

Sửa `src/data/words.json`, mỗi từ có dạng:

```json
{ "id": "harvest", "word": "harvest", "meaning": "thu hoạch", "example": "Farmers harvest rice in autumn.", "level": "B1" }
```

- `id` và `meaning` phải là duy nhất (test `src/data/words.test.ts` sẽ kiểm tra).
- `level` là một trong `A1`, `A2`, `B1`, `B2`.

## Chơi online

1. Người A chọn **Online 1v1 → Tạo phòng**, rồi gửi mã 6 ký tự hoặc bấm **Copy link mời** (dạng `…/vocab-battle/?room=ABC123`).
2. Người B mở link hoặc nhập mã rồi bấm **Vào phòng**.
3. Khi đã thấy tên nhau, chủ phòng bấm **Chọn từ vựng**, chọn bộ từ rồi bấm **Tiếp**. Khách xem được bộ từ nhưng không sửa được.
4. Mỗi bên xem trước rồi bấm **Sẵn sàng**. Khi cả hai cùng sẵn sàng, game đếm ngược 3-2-1 rồi vào trận.

Nếu không kết nối được sau 15 giây, hãy thử mạng khác (ví dụ 4G), vì một số mạng công ty/trường học chặn WebRTC.

## Kiến trúc

- `src/game/`: game logic thuần (damage, combo, chọn câu hỏi, engine) và `Match` (bộ đếm giờ), dùng chung cho cả 3 chế độ.
- `src/controllers/`: các "player controller" (Bot). Người chơi thật trả lời qua UI.
- `src/net/`: `protocol.ts` (các message type), `GameTransport` (interface), `peerTransport.ts` (cài đặt bằng PeerJS), `host.ts` (host là authoritative), `guest.ts`. Muốn đổi sang Supabase Realtime hoặc SignalR thì chỉ cần viết một `GameTransport` mới.

Push vào `main` sẽ chạy test, build và deploy lên GitHub Pages (`.github/workflows/deploy.yml`).
