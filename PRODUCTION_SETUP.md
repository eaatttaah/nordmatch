# NordMatch Production

Bu sürüm artık `data.json` kullanmaz. Gerçek PostgreSQL veritabanı kullanır.

## Kurulum
1. PostgreSQL veritabanı oluştur.
2. `.env.example` içeriğini hosting panelindeki Environment Variables bölümüne gir.
3. `npm install`
4. `npm run db:init`
5. `npm start`

## Gerçek site için sıradaki bağlantılar
- PostgreSQL: hazır
- Gerçek ödeme: henüz bağlanmadı
- Kalıcı fotoğraf depolama: henüz bağlanmadı
- Gerçek e-posta doğrulama: henüz bağlanmadı
- Domain + HTTPS: hosting aşamasında bağlanacak

Önemli:
Bu paket yerel JSON demo yerine gerçek sunucu/veritabanı mimarisine geçiş paketidir.
