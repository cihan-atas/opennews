import { createContext, useContext, useState } from 'react';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  // Kuyruk tabanlı oynatıcı: track listesi + aktif indeks.
  const [queue, setQueueState] = useState([]); // [{ src, title, category, autoPlay, podcastId }]
  const [index, setIndex] = useState(0);

  const track = queue.length > 0 && index >= 0 && index < queue.length ? queue[index] : null;

  // Tekli oynatma (geriye uyumlu): kuyruğu tek elemana indirger.
  const setTrack = (src, title = '', category = '', autoPlay = false, podcastId = null) => {
    setQueueState([{ src, title, category, autoPlay, podcastId }]);
    setIndex(0);
  };

  // Kuyruk oynatma: birden çok track'i sırayla çalmak için. Otomatik oynatma açık.
  const setQueue = (tracks, startIndex = 0) => {
    if (!tracks || tracks.length === 0) return;
    const normalized = tracks.map((t) => ({ autoPlay: true, ...t }));
    setQueueState(normalized);
    setIndex(Math.max(0, Math.min(startIndex, normalized.length - 1)));
  };

  const clearTrack = () => { setQueueState([]); setIndex(0); };

  const hasNext = index < queue.length - 1;
  const hasPrev = index > 0;
  const playNext = () => setIndex((i) => (i < queue.length - 1 ? i + 1 : i));
  const playPrev = () => setIndex((i) => (i > 0 ? i - 1 : i));

  return (
    <PlayerContext.Provider value={{ track, queue, index, setTrack, setQueue, clearTrack, playNext, playPrev, hasNext, hasPrev }}>
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => useContext(PlayerContext);
