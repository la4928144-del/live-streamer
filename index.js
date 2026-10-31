const express = require('express');
const { spawn } = require('child_process');
const app = express();
const PORT = process.env.PORT || 3000;

// ذاكرة مؤقتة لحفظ البث الشغال حالياً لكي نتمكن من إيقافه
let activeStreams = {};

app.use(express.urlencoded({ extended: true }));

// واجهة الموقع (HTML & CSS)
app.get('/', (req, res) => {
    const isStreaming = Object.keys(activeStreams).length > 0;

    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>مطلق البث المباشر السريع المطور</title>
            <style>
                body { font-family: Arial, sans-serif; background-color: #f0f2f5; text-align: center; padding: 30px; margin: 0; }
                .container { background: white; padding: 30px; border-radius: 12px; max-width: 550px; margin: auto; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
                h2 { color: #1877f2; margin-bottom: 25px; }
                .form-group { text-align: right; margin-bottom: 15px; }
                label { font-weight: bold; display: block; margin-bottom: 5px; color: #333; }
                input, select { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-size: 14px; }
                .btn-start { background-color: #1877f2; color: white; border: none; padding: 14px; font-size: 16px; border-radius: 6px; cursor: pointer; width: 100%; font-weight: bold; margin-top: 15px; }
                .btn-start:hover { background-color: #166fe5; }
                .btn-stop { background-color: #e41e3f; color: white; border: none; padding: 14px; font-size: 16px; border-radius: 6px; cursor: pointer; width: 100%; font-weight: bold; margin-top: 15px; }
                .btn-stop:hover { background-color: #c21833; }
                .status-box { padding: 15px; border-radius: 6px; margin-bottom: 20px; font-weight: bold; }
                .status-on { background-color: #e7f5ff; color: #1c7ed6; border: 1px solid #a5d8ff; }
                .status-off { background-color: #f8f9fa; color: #868e96; border: 1px solid #dee2e6; }
                .footer { margin-top: 25px; font-size: 12px; color: #777; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>بث m3u8 و mpd لفيسبوك مع غطاء الشعار</h2>
                
                \${isStreaming ? `
                    <div class="status-box status-on">🟢 البث المباشر شغال حالياً الآن!</div>
                    <form action="/stop-stream" method="POST">
                        <button type="submit" class="btn-stop">🛑 إيقاف البث المباشر الحالي</button>
                    </form>
                ` : `
                    <div class="status-box status-off">⚪ السيرفر فارغ وجاهز لبث جديد</div>
                    <form action="/start-stream" method="POST">
                        <div class="form-group">
                            <label>رابط البث (m3u8 أو mpd):</label>
                            <input type="url" name="streamUrl" placeholder="https://example.com أو .mpd" required>
                        </div>
                        
                        <div class="form-group">
                            <label>مفتاح بث فيسبوك (Stream Key):</label>
                            <input type="text" name="streamKey" placeholder="FB-xxxxxxxxxxxxxxxxx" required>
                        </div>

                        <div class="form-group">
                            <label>رابط صورة غطاء الشعار (رابط مباشر PNG):</label>
                            <input type="url" name="logoUrl" placeholder="https://site.com (اختياري)">
                        </div>

                        <div class="form-group">
                            <label>حجم غطاء الشعار (إذا تم وضع رابط صورة):</label>
                            <select name="logoSize">
                                <option value="small">صغير (50 بكسل)</option>
                                <option value="medium" selected>متوسط (100 بكسل)</option>
                                <option value="large">كبير (150 بكسل)</option>
                            </select>
                        </div>
                        
                        <button type="submit" class="btn-start">🚀 تشغيل البث المباشر</button>
                    </form>
                `}
                
                <div class="footer">سيرفر البث الشخصي الخاص بك</div>
            </div>
        </body>
        </html>
    `);
});

// تشغيل البث
app.post('/start-stream', (req, res) => {
    if (Object.keys(activeStreams).length > 0) {
        return res.send('هناك بث شغال بالفعل، يرجى إيقافه أولاً.');
    }

    const { streamUrl, streamKey, logoUrl, logoSize } = req.body;
    const fbIngestUrl = `rtmps://://facebook.com\${streamKey}`;

    let ffmpegArgs = [];

    // الكشف التلقائي إذا كان الرابط يخص بث MPD (Dash) لإضافة الإعدادات المناسبة له
    if (streamUrl.toLowerCase().includes('.mpd')) {
        ffmpegArgs.push('-allowed_extensions', 'ALL', '-fflags', '+genpts');
    }

    ffmpegArgs.push('-re', '-i', streamUrl);

    // في حال أراد المستخدم وضع لوغو لتغطية الشعار
    if (logoUrl && logoUrl.trim() !== '') {
        ffmpegArgs.push('-i', logoUrl);

        let logoWidth = '100';
        if (logoSize === 'small') logoWidth = '50';
        if (logoSize === 'large') logoWidth = '150';

        // تركيب اللوغو أعلى اليمين (على بعد 10 بكسل من الحواف)
        let filterString = `[1:v]scale=\${logoWidth}:-1[img];[0:v][img]overlay=10:10`;
        ffmpegArgs.push('-filter_complex', filterString);
        
        // عند استخدام فلاتر تركيب الصور، نستخدم ترميزاً سريعاً وخفيفاً جداً للمحافظة على الأداء
        ffmpegArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency');
    } else {
        // إذا لم يختر صورة، يتم نسخ الفيديو الأصلي تماماً (Copy) باستهلاك خفيف جداً
        ffmpegArgs.push('-c:v', 'copy');
    }

    // إعدادات الصوت الافتراضية والصيغة لفيسبوك
    ffmpegArgs.push('-c:a', 'aac', '-f', 'flv', fbIngestUrl);

    // تشغيل FFmpeg
    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    const streamId = Date.now().toString();
    activeStreams[streamId] = ffmpegProcess;

    ffmpegProcess.stderr.on('data', (data) => {
        console.log(`FFmpeg: \${data}`);
    });

    ffmpegProcess.on('close', (code) => {
        console.log(`توقف البث. كود: \${code}`);
        delete activeStreams[streamId];
    });

    res.redirect('/');
});

// إيقاف البث
app.post('/stop-stream', (req, res) => {
    const streamIds = Object.keys(activeStreams);
    if (streamIds.length > 0) {
        streamIds.forEach(id => {
            activeStreams[id].kill('SIGINT'); // إيقاف بأمان فوراً
            delete activeStreams[id];
        });
    }
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`السيرفر يعمل بنجاح على المنفذ \${PORT}`);
});
