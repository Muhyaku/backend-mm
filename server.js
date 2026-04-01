const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. KONEKSI MONGODB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ BOOM! Berhasil terhubung ke MongoDB!'))
  .catch((err) => console.error('❌ Gagal connect ke MongoDB:', err));

// 2. SCHEMA TRANSAKSI
const transactionSchema = new mongoose.Schema({
  sheet: { type: String, required: true, index: true },
  tanggal: { type: String, required: true, index: true },
  cash: { type: Number, default: 0 },
  bca: { type: Number, default: 0 },
  gofood: { type: Number, default: 0 },
  jenisPengeluaran: { type: String, default: "" },
  totalPengeluaran: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  printCount: { type: Number, default: 0 }
}, { timestamps: true });
const Transaction = mongoose.model('Transaction', transactionSchema);

// 3. SCHEMA BIAYA TETAP ROUTINE
const recurringSchema = new mongoose.Schema({
  sheet: { type: String, required: true },
  nama: { type: String, required: true },
  nominal: { type: Number, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, default: null }, 
  frekuensi: { type: String, enum: ['bulanan', 'tahunan', 'harian'], required: true },
  intervalHari: { type: Number, default: 0 },
  lastApplied: { type: Date, default: null },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
const Recurring = mongoose.model('Recurring', recurringSchema);

// 4. SCHEMA SETTINGS DINAMIS
const settingSchema = new mongoose.Schema({
  settingKey: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: false },
  branches: { type: [String], default: [] }, // Filter cabang mana yg kena efek
  description: { type: String, default: "" }
}, { timestamps: true });
const Setting = mongoose.model('Setting', settingSchema);

// INIT DEFAULT SETTINGS JIKA KOSONG
const initSettings = async () => {
  const count = await Setting.countDocuments();
  if (count === 0) {
    await Setting.insertMany([
      { settingKey: 'scramble_keypad', name: 'Acak Tombol PIN Kasir', description: 'Mengacak posisi angka di layar login untuk mencegah orang menghapal gerakan jari kasir (Anti-Ngintip).', isActive: false, branches: [] },
      { settingKey: 'pin_table_column', name: 'Bekukan Kolom Tabel (Pin Header)', description: 'Membekukan kolom Aksi dan Total di laporan agar tidak ikut tergeser saat di-scroll menyamping (Cocok untuk Layar Tablet).', isActive: true, branches: [] }
    ]);
  }
};
initSettings();

// ==========================================
// API TRANSAKSI
// ==========================================
app.get('/api/transactions', async (req, res) => {
  try {
    const { sheet } = req.query;
    const filter = sheet ? { sheet: sheet } : {};
    const data = await Transaction.find(filter).sort({ createdAt: 1 });
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/transactions', async (req, res) => {
  try {
    if (Array.isArray(req.body)) {
      const inserted = await Transaction.insertMany(req.body);
      return res.status(201).json({ status: 'success', data: inserted });
    }
    const newTransaction = new Transaction(req.body);
    await newTransaction.save();
    res.status(201).json({ status: 'success', data: newTransaction });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// SOFT DELETE
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const updatedTx = await Transaction.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    res.status(200).json({ status: 'success', data: updatedTx });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// HARD DELETE (PERMANENT)
app.delete('/api/transactions/hard/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Data dihapus permanen!' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.patch('/api/transactions/:id/print', async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ status: 'error', message: 'Data tidak ditemukan' });
    tx.printCount += 1;
    await tx.save();
    res.status(200).json({ status: 'success', printCount: tx.printCount });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// ==========================================
// API BIAYA ROUTINE
// ==========================================
app.get('/api/recurring', async (req, res) => {
  try {
    const data = await Recurring.find().sort({ createdAt: -1 });
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/recurring', async (req, res) => {
  try {
    const newRec = new Recurring(req.body);
    await newRec.save();
    res.status(201).json({ status: 'success', data: newRec });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.delete('/api/recurring/:id', async (req, res) => {
  try {
    await Recurring.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Routine deleted' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/recurring/trigger', async (req, res) => {
  try {
    const rules = await Recurring.find({ isActive: true });
    const today = new Date();
    let generatedCount = 0;
    const daysMap = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const monthsMap = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    for (const rule of rules) {
      let currentDate = rule.lastApplied ? new Date(rule.lastApplied) : new Date(rule.startDate);
      if (rule.lastApplied) {
        if (rule.frekuensi === 'bulanan') currentDate.setMonth(currentDate.getMonth() + 1);
        else if (rule.frekuensi === 'tahunan') currentDate.setFullYear(currentDate.getFullYear() + 1);
        else if (rule.frekuensi === 'harian') currentDate.setDate(currentDate.getDate() + rule.intervalHari);
      }

      while (currentDate <= today) {
        if (rule.endDate && currentDate > new Date(rule.endDate)) {
           rule.isActive = false; await rule.save(); break;
        }

        const tglFormat = `${daysMap[currentDate.getDay()]}, ${String(currentDate.getDate()).padStart(2, '0')} ${monthsMap[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
        await Transaction.create({ sheet: rule.sheet, tanggal: tglFormat, cash: 0, bca: 0, gofood: 0, jenisPengeluaran: `[OPERASIONAL ROUTINE] ${rule.nama}`, totalPengeluaran: rule.nominal });

        rule.lastApplied = new Date(currentDate); 
        await rule.save();
        generatedCount++;

        if (rule.frekuensi === 'bulanan') currentDate.setMonth(currentDate.getMonth() + 1);
        else if (rule.frekuensi === 'tahunan') currentDate.setFullYear(currentDate.getFullYear() + 1);
        else if (rule.frekuensi === 'harian') currentDate.setDate(currentDate.getDate() + rule.intervalHari);
      }
    }
    res.status(200).json({ status: 'success', generated: generatedCount });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// ==========================================
// API SETTINGS
// ==========================================
app.get('/api/settings', async (req, res) => {
  try {
    const data = await Setting.find();
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.put('/api/settings/:id', async (req, res) => {
  try {
    const updated = await Setting.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json({ status: 'success', data: updated });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Backend nyala di http://localhost:${PORT}`));
}
module.exports = app;
