const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// 1. Koneksi ke MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ BOOM! Berhasil terhubung ke MongoDB!'))
  .catch((err) => console.error('❌ Gagal connect ke MongoDB:', err));

// 2. Schema dan Model (DITAMBAH isDeleted, deletedAt, printCount)
const transactionSchema = new mongoose.Schema({
  sheet: { type: String, required: true },
  tanggal: { type: String, required: true },
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

// 3. API Tarik Data
app.get('/api/transactions', async (req, res) => {
  try {
    const { sheet } = req.query;
    const filter = sheet ? { sheet: sheet } : {};
    const data = await Transaction.find(filter).sort({ createdAt: 1 });
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// 4. API Tambah Data
app.post('/api/transactions', async (req, res) => {
  try {
    const newTransaction = new Transaction(req.body);
    await newTransaction.save();
    res.status(201).json({ status: 'success', data: newTransaction });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// 5. API Hapus Data (SOFT DELETE BARU)
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const updatedTx = await Transaction.findByIdAndUpdate(
      req.params.id, 
      { isDeleted: true, deletedAt: new Date() },
      { new: true }
    );
    res.status(200).json({ status: 'success', message: 'Data dipindah ke history terhapus', data: updatedTx });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// 6. API Tambah Print Counter (BARU)
app.patch('/api/transactions/:id/print', async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ status: 'error', message: 'Data tidak ditemukan' });
    
    tx.printCount += 1;
    await tx.save();
    res.status(200).json({ status: 'success', printCount: tx.printCount });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// 7. Konfigurasi Port & Export untuk Vercel
const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Mesin Backend menyala di http://localhost:${PORT}`);
  });
}

module.exports = app;
