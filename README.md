# Công cụ Check Zalo Public Info & Đối chiếu dữ liệu hàng loạt

Node.js 20+ và TypeScript. Tự động chuẩn hóa đầu số điện thoại **84 / +84 thành đầu số 0**. Tra cứu và phát hiện tài khoản **Zalo có thông tin public hay không** (Tên, UID, Avatar, Giới tính, Ngày sinh, Bio) qua `zca-js`. Hỗ trợ dán trực tiếp danh sách SĐT và **xuất riêng danh sách chỉ các số check được Zalo**.

## Tính năng nổi bật

1. **Chuẩn hóa SĐT tự động:** Mọi số dạng `84904461106`, `+84904461106`, `84 904.461.106` đều tự động chuyển thành `0904461106`.
2. **Kiểm tra thông tin Zalo public:**
   - Trạng thái: Có thông tin public / Không có / Riêng tư / Không tồn tại.
   - Trích xuất: Tên Zalo, Zalo UID, Avatar, Giới tính, Ngày sinh, Tiểu sử.
3. **Tra cứu nhanh 1 số:** Nhập số bất kỳ trên giao diện để xem ngay kết quả.
4. **Tra cứu hàng loạt đa kênh:**
   - Tải tệp lên (`.xlsx`, `.txt`, `.csv`).
   - Hoặc dán trực tiếp danh sách số điện thoại vào ô văn bản.
5. **Xuất kết quả linh hoạt theo yêu cầu:**
   - **Tải TXT (Chỉ SĐT có Zalo):** File text mỗi dòng 1 số dạng 09xxx.
   - **Tải Excel (Chỉ số có Zalo):** Bảng Excel chi tiết các số tìm thấy Zalo.
   - **Sao chép 1 click:** Sao chép toàn bộ số điện thoại có Zalo vào clipboard.
   - **Tải toàn bộ kết quả:** Đầy đủ trạng thái cho tất cả các dòng.

## Cài đặt và chạy

### Giao diện web trên máy

```sh
npm install
npm run ui
```

Mở trình duyệt tại: **`http://127.0.0.1:3000`**

1. Bấm **Tạo mã QR đăng nhập**, dùng app Zalo trên điện thoại quét mã và xác nhận.
2. Thử nhanh 1 số tại ô **Kiểm tra nhanh 1 số điện thoại**.
3. Để tra hàng loạt: chọn tab **Dán danh sách số** (hoặc Tải tệp lên), bấm **Bắt đầu kiểm tra hàng loạt**.
4. Khi chạy xong, bấm **Tải TXT (Chỉ SĐT có Zalo)** hoặc **Sao chép danh sách** để lấy các số check được Zalo.

### Dòng lệnh

```sh
npm install
npm test
npm run typecheck
npm start -- --input examples/input.txt --tax-table examples/companies.csv --output result.csv
```

Chạy thực tế với tệp của bạn:

```sh
npm start -- --input data.xlsx --tax-table companies.xlsx --output result.xlsx --checkpoint state.checkpoint.jsonl --concurrency 1 --delay-ms 1000
```

`--retry-failed` thử lại các dòng `lookup_failed` đã lưu. Chạy lại cùng lệnh sẽ tiếp tục từ checkpoint; đổi nội dung đầu vào hoặc bảng nguồn sẽ tạo khóa tiến độ mới. Không dùng chung một tệp checkpoint cho nhiều tiến trình chạy đồng thời. Kết quả xuất ghi đè tệp đầu ra. Nếu muốn chạy từ đầu, chỉ xóa **đúng** tệp checkpoint của lượt chạy sau khi đã sao lưu nếu cần. Mặc định gọi nguồn tối đa 1 lượt/giây, 1 tác vụ đồng thời; `--concurrency` từ 1 đến 20, `--delay-ms` không âm. Với bảng nội bộ tra cứu nhanh có thể đặt `--delay-ms 0`; nếu sau này dùng nguồn được cấp phép, đặt tốc độ trong hạn mức nguồn đó. Dữ liệu trùng cùng MST chỉ tra một lần mỗi lượt chạy, nhưng vẫn giữ đủ dòng đầu ra.

## Tệp đầu vào

- TXT UTF-8: mỗi dòng `mst:0101234567` hoặc `phone:0912345678` (cũng nhận dấu `,`, `;`, tab thay dấu `:`). Dòng trống bỏ qua. MST 13 số hoặc `10chữsố-3chữsố` có thể không cần tiền tố. **Số 10 chữ số luôn phải có tiền tố** để tránh nhầm MST với điện thoại.
- Excel `.xlsx`: sheet đầu tiên. Mẫu chuẩn có cột **`type`**, **`value`**; các hàng kế là `mst`/`phone` và chuỗi giá trị. Mẫu danh bạ có cột **`phone`**, tùy chọn **`ten_khach_hang`** và **`ten_nguoi_lien_he`**. Số điện thoại dạng Number được chấp nhận nếu là số nguyên an toàn, nhưng nên định dạng cột là **Text** để giữ số 0 đầu. Cột không có tiêu đề không được coi là tên đại diện pháp luật.
- Bảng nguồn MST: CSV UTF-8 với hàng đầu `mst,ten_cong_ty`, hoặc XLSX sheet đầu có hai tiêu đề `mst`, `ten_cong_ty`; MST lưu dạng chuỗi. Bảng này chỉ dùng cho **doanh nghiệp**, không nhập MST cá nhân. Dữ liệu trùng MST khác tên bị từ chối.
- File ví dụ trong `examples/` là dữ liệu **giả minh họa định dạng**, không phải kết quả tra cứu thực tế.

Đầu ra CSV/XLSX gồm `line,value,type,companyName,contactName,name,mst,legalRepresentative,representativeStatus,status,source,error`. `name` là tên Zalo khi bật tra Zalo hoặc tên công ty từ bảng MST; `companyName` giữ tên khách hàng đầu vào. `legalRepresentative` **để trống**, `representativeStatus` giải thích chưa có nguồn xác minh. Không suy đoán tên đại diện pháp luật từ tên Zalo, số điện thoại hoặc cột không có tiêu đề. Với MST, `not_found` = vắng trong bảng; với Zalo, `not_found` = thư viện trả về không có tên, không chứng minh số điện thoại không có tài khoản. `lookup_failed` = lỗi gọi nguồn, `unavailable` = chưa bật hoặc chưa có nguồn, `invalid` = giá trị sai hoặc mơ hồ. CSV xuất UTF-8 BOM cho Excel và giảm rủi ro công thức bảng tính. `source` chứa mã băm rút gọn của bảng MST hoặc `zca-js:Zalo` để truy vết nguồn, **không xác nhận dữ liệu đáng tin cậy**.

## Bảo vệ dữ liệu

Chỉ nhập dữ liệu bạn có quyền xử lý. Dữ liệu đầu vào, đầu ra và `*.checkpoint.jsonl` lưu trên máy **không mã hóa**; giới hạn quyền truy cập, không gửi lên kho mã nguồn hoặc chia sẻ file tùy tiện; xóa theo chính sách lưu trữ của bạn. Phiên Zalo chỉ lưu trong bộ nhớ; không lưu cookie, mật khẩu hoặc token. Log CLI chỉ có tổng số theo trạng thái và đường dẫn xuất. Trên quy mô 1.000–10.000 dòng, dữ liệu và kết quả được giữ trong bộ nhớ; checkpoint được ghi từng dòng để tiếp tục sau gián đoạn. Không cam kết hoạt động hay tốc độ từ Zalo; dừng nếu Zalo báo hạn chế tài khoản hoặc giới hạn truy cập.
