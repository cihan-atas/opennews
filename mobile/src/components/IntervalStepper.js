/**
 * Bildirim aralığı seçici: solda −, ortada değer, sağda +.
 *
 * 15 dk ile 24 saat arasında 95 adım var; tek tek basmak yorucu olduğu için
 * butonlar basılı tutulunca kademeli hızlanır (15 → 30 → 60 dk sıçrama).
 * Backend de aynı sınırı doğrular (routers/rss_reader.py → _validate_rule).
 */
import { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { radius } from '../theme';

export const INTERVAL_STEP = 15;
export const INTERVAL_MIN = 15;
export const INTERVAL_MAX = 1440;

/** 90 → "1 sa 30 dk", 60 → "1 sa", 45 → "45 dk" */
export function formatInterval(m) {
  const total = Number(m) || INTERVAL_MIN;
  const h = Math.floor(total / 60);
  const mm = total % 60;
  if (h === 0) return `${mm} dk`;
  return mm === 0 ? `${h} sa` : `${h} sa ${mm} dk`;
}

export default function IntervalStepper({ value, onChange, colors, hint = true }) {
  const styles = makeStyles(colors);
  const cur = Number(value) || INTERVAL_MIN;

  const timerRef = useRef(null);
  const countRef = useRef(0);
  const valueRef = useRef(cur);   // tekrar sırasında anlık değer buradan okunur

  useEffect(() => { valueRef.current = Number(value) || INTERVAL_MIN; }, [value]);

  const stop = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    countRef.current = 0;
  };

  // Ekrandan çıkarken kalan zamanlayıcı olmasın.
  useEffect(() => stop, []);

  const apply = (delta) => {
    const now = valueRef.current;
    const next = Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, now + delta));
    if (next === now) return false;      // sınıra dayandı
    valueRef.current = next;
    onChange(next);
    return true;
  };

  const start = (dir) => {
    apply(dir * INTERVAL_STEP);          // ilk dokunuşun kendisi
    countRef.current = 0;

    const tick = () => {
      countRef.current += 1;
      const n = countRef.current;
      const mult = n > 20 ? 4 : n > 8 ? 2 : 1;
      const delay = n > 20 ? 60 : n > 8 ? 80 : 110;
      if (!apply(dir * INTERVAL_STEP * mult)) { stop(); return; }
      timerRef.current = setTimeout(tick, delay);
    };

    timerRef.current = setTimeout(tick, 400);   // basılı tutma eşiği
  };

  const atMin = cur <= INTERVAL_MIN;
  const atMax = cur >= INTERVAL_MAX;

  return (
    <>
      <View style={styles.row}>
        <Pressable onPressIn={() => start(-1)} onPressOut={stop} disabled={atMin}
          style={[styles.btn, atMin && { opacity: 0.35 }]} hitSlop={6}>
          <Text style={styles.sign}>−</Text>
        </Pressable>
        <View style={styles.value}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '800' }}>
            {formatInterval(cur)}
          </Text>
        </View>
        <Pressable onPressIn={() => start(1)} onPressOut={stop} disabled={atMax}
          style={[styles.btn, atMax && { opacity: 0.35 }]} hitSlop={6}>
          <Text style={styles.sign}>+</Text>
        </Pressable>
      </View>
      {hint && (
        <Text style={{ color: colors.textFaint, fontSize: 11, marginTop: 6 }}>
          15 dakikalık adımlarla · basılı tutunca hızlanır · 15 dk – 24 saat
        </Text>
      )}
    </>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  btn: {
    width: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center',
  },
  sign: { color: colors.primaryLight, fontSize: 22, fontWeight: '800', lineHeight: 26 },
  value: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12,
  },
});
