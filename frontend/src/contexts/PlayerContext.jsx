import { createContext, useContext, useState } from 'react';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const [track, setTrackState] = useState(null); // { src, title, category, autoPlay }

  const setTrack = (src, title = '', category = '', autoPlay = false) => {
    setTrackState({ src, title, category, autoPlay });
  };

  const clearTrack = () => setTrackState(null);

  return (
    <PlayerContext.Provider value={{ track, setTrack, clearTrack }}>
      {children}
    </PlayerContext.Provider>
  );
}

export const usePlayer = () => useContext(PlayerContext);
