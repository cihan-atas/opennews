import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function Onboarding() {
  const [categories, setCategories] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/categories/`)
      .then(res => res.json()).then(data => setCategories(data))
      .catch(() => showToast("Kategoriler yüklenemedi.", "error"));
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
  };

  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 2000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  const toggleCategory = (id) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(itemId => itemId !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleFinish = async () => {
    // BACKEND GÜNCELLEMESİ: Minimum sınır 2'ye çekildi
    if (selectedIds.length < 2) {
      showToast("Devam etmek için en az 2 kategori seçmelisin!", "error");
      return;
    }
    
    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/users/interests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ category_ids: selectedIds }), 
      });

      if (response.ok) navigate('/home');
      else showToast("Ayarların kaydedilemedi.", "error");
    } catch (error) {
      showToast("Bağlantı hatası yaşandı.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const styles = {
    container: {
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      minHeight: '100vh', backgroundColor: '#020617', fontFamily: "'Inter', sans-serif",
      backgroundImage: 'radial-gradient(circle at 50% -20%, rgba(99, 102, 241, 0.15) 0%, transparent 50%)',
    },
    toast: {
      position: 'fixed', top: toast.show ? '30px' : '-100px', left: '50%', transform: 'translateX(-50%)',
      backgroundColor: toast.type === 'success' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
      color: toast.type === 'success' ? '#10b981' : '#ef4444',
      border: `1px solid ${toast.type === 'success' ? '#10b981' : '#ef4444'}`,
      backdropFilter: 'blur(12px)', padding: '12px 24px', borderRadius: '16px',
      display: 'flex', alignItems: 'center', gap: '12px', fontWeight: '600',
      transition: 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)', opacity: toast.show ? 1 : 0, zIndex: 9999,
    },
    chip: (isSelected) => ({
      padding: '12px 24px', margin: '6px', borderRadius: '16px', cursor: 'pointer',
      border: '1px solid', boxSizing: 'border-box',
      borderColor: isSelected ? '#818cf8' : 'rgba(255, 255, 255, 0.1)',
      backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 23, 42, 0.4)',
      color: isSelected ? '#fff' : '#94a3b8',
      fontWeight: '500', transition: 'all 0.2s ease',
    })
  };

  return (
    <div style={styles.container}>
      <div style={styles.toast}>
        <span>{toast.type === 'success' ? '✨' : '⚠️'}</span>
        {toast.message}
      </div>

      <div style={{ background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(20px)', borderRadius: '32px', border: '1px solid rgba(255, 255, 255, 0.05)', padding: '3rem', width: '90%', maxWidth: '700px', textAlign: 'center' }}>
        <h1 style={{ color: 'white', marginBottom: '1rem', fontSize: '2.5rem', fontWeight: '800' }}>Seni Neler Heyecanlandırır?</h1>
        {/* BACKEND GÜNCELLEMESİ: Metin 2 olarak düzeltildi */}
        <p style={{ color: '#94a3b8', marginBottom: '2.5rem', fontSize: '1.1rem' }}>En az 2 ilgi alanı seçerek dünyanı oluştur.</p>
        
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
          {categories.map(cat => (
            <div key={cat.id} onClick={() => toggleCategory(cat.id)} style={styles.chip(selectedIds.includes(cat.id))}>
              {cat.name}
            </div>
          ))}
        </div>

        {/* BACKEND GÜNCELLEMESİ: Buton mantığı 2'ye göre ayarlandı */}
        <button onClick={handleFinish} disabled={isSubmitting || selectedIds.length < 2} style={{
          marginTop: '3rem', padding: '16px 48px', borderRadius: '14px', border: 'none',
          background: selectedIds.length < 2 ? '#1e293b' : 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)',
          color: selectedIds.length < 2 ? '#64748b' : 'white', 
          cursor: selectedIds.length < 2 ? 'not-allowed' : 'pointer', 
          fontWeight: '700', transition: 'all 0.3s'
        }}>
          {isSubmitting ? 'Hazırlanıyor...' : 'Dünyamı Oluştur'}
        </button>
      </div>
    </div>
  );
}

export default Onboarding;