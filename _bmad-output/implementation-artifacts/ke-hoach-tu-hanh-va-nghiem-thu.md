# Kế hoạch tự hành & tự nghiệm thu — AutoTest MVP

Ngày chốt: 2026-11-07 · Chủ dự án duyệt 1 lần: "Tạo dev-story cho tất cả các epic và story, tôi muốn chốt 1 lần và đến khi bạn tự nghiệm thu và bàn giao cho tôi phần mềm hoàn chỉnh."

## Phạm vi cam kết

Toàn bộ 19 story của 5 epic trong `stories/` — từ khung monorepo tới gói bàn giao chạy trên máy thật. Không thêm tính năng ngoài PRD; không bỏ bớt tiêu chí nghiệm thu (AC) của bất kỳ story nào.

## Thứ tự thực hiện (theo phụ thuộc)

S1.1 → S1.2 → S1.3 → S3.0 (song song từ sau S1.1) → S2.1 → S2.2 → S2.3 → S3.1 → S3.2 → S3.3 → S3.4 → S2.4 → S4.1 → S4.2 → S4.3 → S5.3 → S5.1 → S5.2 → S5.4

## Cổng nghiệm thu cho từng story (tự nghiệm thu)

Một story chỉ được đánh dấu `done` khi có đủ, ghi trong mục Dev Agent Record của chính file story:

1. Mọi AC đều có bằng chứng kiểm chứng thật (lệnh đã chạy + đầu ra, test tự động đạt, ảnh/video nếu là story giao diện/stream).
2. `pnpm build`, `pnpm typecheck` và test của gói liên quan đều đạt.
3. Rà soát code (code review theo BMAD) cho chính story đó: tự đọc lại diff, sửa lỗi phát hiện được trước khi chuyển story.

## Cách tổ chức code và đẩy GitHub

- Code phát triển trong thư mục làm việc riêng, đẩy theo **đợt từng epic** lên branch `phat-trien/mvp` của repo `tranuy123/AutoTest` (giảm số lần duyệt thẻ GitHub), mỗi đợt kèm báo cáo ngắn trong chat chính.
- Tài liệu BMAD (story, sprint-status, báo cáo) cập nhật thẳng lên `main` như các đợt trước.
- Khi toàn bộ đạt: mở PR `phat-trien/mvp` → `main` để chủ dự án duyệt lần cuối và hợp nhất. Chủ dự án clone về máy thật, chạy theo `docs/HUONG-DAN-MAY-THAT.md` (S5.4).

## Giới hạn môi trường đã biết trước (nói thẳng từ đầu)

- Muse VM **không có Docker**: các AC về `docker compose up` được nghiệm thu bằng cách chạy trực tiếp các service tương đương bằng Node trên VM + kiểm tra cú pháp/nội dung compose; bước chạy compose thật là bước đầu tiên trong tài liệu bàn giao để chủ dự án xác nhận trên máy thật. Không được ghi "đã chạy docker compose" khi chưa chạy.
- Đích kiểm thử khi tự nghiệm thu là **bản CRM_Loyalty chạy cục bộ** (seed mẫu) đóng vai UAT. Vòng kiểm chứng cuối trên **UAT thật** cần chủ dự án cấp: URL UAT, tài khoản 5 vai, tenant/chi nhánh test riêng — đây là đầu vào duy nhất có thể khiến việc bàn giao phải chờ, và sẽ được nêu rõ trong báo cáo bàn giao thay vì lặng lẽ bỏ qua.
- pnpm chưa có trên VM: cài qua corepack ở S1.1, ghi lại phiên bản đã dùng.

## Khi nào mới làm phiền chủ dự án

Chỉ 3 trường hợp: (1) cần đầu vào UAT thật ở vòng cuối; (2) phát hiện mâu thuẫn trong PRD/kiến trúc buộc phải đổi phạm vi; (3) một AC không thể đạt vì giới hạn kỹ thuật thật — kèm bằng chứng và phương án thay thế. Ngoài ra không hỏi lại từng bước.

## Định nghĩa "phần mềm hoàn chỉnh" khi bàn giao

- 19/19 story đạt cổng nghiệm thu ở trên (hoặc liệt kê rõ story nào chưa, vì sao, kèm bằng chứng).
- Kịch bản mẫu S4.3 chạy đạt 3 lần liên tiếp trên đích kiểm thử cục bộ.
- Repo có đủ: mã nguồn, docker-compose, `.env.example`, tài liệu máy thật, báo cáo tự nghiệm thu toàn dự án.
- PR bàn giao mở sẵn trên GitHub chờ chủ dự án duyệt.
