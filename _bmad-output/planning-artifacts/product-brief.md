# Product Brief — AutoTest (BMAD Phase 1: Analysis)

Ngày: 2026-11-07 · Chủ dự án: Uy (tranuy123) · Trạng thái: Chốt để vào PRD

## Vấn đề

CRM_Loyalty đã có bộ test Vitest + Playwright e2e lớn, nhưng cách chạy hiện tại là chạy lệnh trên máy ảo, headless và song song: chủ dự án **không nhìn thấy phần mềm được thao tác như thế nào**, không tự nạp được kịch bản nghiệp vụ mới, và việc đối chiếu số liệu báo cáo (doanh thu, theo khách hàng, hiệu quả chiến dịch) vẫn phải đọc log/report rời rạc. Mỗi lần có nhánh tích hợp mới lại cần người rành kỹ thuật đứng chạy.

## Giải pháp đề xuất

Một **app AutoTest chạy trên máy thật của chủ dự án**:

1. Nút **nạp kịch bản** (file hoặc thư viện sẵn) và nút **Bắt đầu/Dừng**.
2. Tự **sinh dữ liệu giống thật** (bệnh nhân, lịch hẹn, hoá đơn, điểm...), điền input thật qua giao diện UAT, để hệ thống CRM tính ra output thật.
3. **Giả lập nhiều vai trò/người dùng cùng lúc** (bệnh nhân, lễ tân, bác sĩ, thu ngân, quản lý), mỗi vai là một phiên trình duyệt tách biệt.
4. **Stream trực tiếp** từng phiên lên một lưới xem — thấy chuột, click, gõ, cuộn như xem người thật thao tác.
5. Cuối kịch bản tự **mở báo cáo và kiểm đếm**: đối chiếu UI = API = DB = số kỳ vọng tính độc lập; lệch là fail và chỉ rõ lệch ở đâu.
6. Lưu video + bảng đối chiếu của từng lần chạy để xem lại.

## Người dùng

- Chính chủ dự án (người duyệt chất lượng CRM trước khi lên Production).
- Về sau: QA/dev của dự án CRM dùng chung bộ kịch bản.

## Vì sao không dùng công cụ có sẵn

BrowserStack/LambdaTest stream được phiên test nhưng không biết nghiệp vụ CRM (sinh dữ liệu phòng khám, oracle tính doanh thu/điểm độc lập, đối chiếu 3 chiều UI/API/DB, đồng bộ nhiều vai theo một ca khám). Giá trị của AutoTest nằm ở lớp nghiệp vụ đó, stream chỉ là một thành phần dùng công nghệ có sẵn (Playwright + Chrome + WebSocket).

## Thành công trông như thế nào

- Chủ dự án không cần chạm vào dòng lệnh: mở app, chọn kịch bản "đặt lịch → check-in → thanh toán → báo cáo doanh thu", bấm chạy, xem 4-5 vai thao tác trực tiếp, và nhận kết luận qua/hỏng kèm bảng đối chiếu số liệu trong vòng vài phút.
- Một lỗi lệch số kiểu báo cáo 38.6 (kỳ vọng 500.000 đ) bị bắt ngay tại lần chạy, kèm video và dòng dữ liệu gây lệch.

## Ngoài phạm vi

- Không test trên Production, không dùng dữ liệu bệnh nhân thật.
- Không thay thế unit test của CRM; AutoTest là tầng kiểm thử chấp nhận trên UAT.
- Không phải dịch vụ cloud cho người ngoài; chạy local trên máy chủ dự án (có thể mở rộng sau).
