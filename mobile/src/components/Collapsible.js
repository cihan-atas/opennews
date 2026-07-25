/**
 * Katlanabilir bölüm başlığı.
 *
 * Ayarlar ve Admin ekranlarındaki uzun listeler (haber tercihleri, bekleyen/onaylı
 * kaynaklar) ekranı boğuyordu. Başlığa dokununca içerik açılıp kapanır.
 *
 * Ok yönü: ▼ kapalı (aşağı açılacak), ▲ açık.
 */
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';

export default function Collapsible({
  title,
  titleStyle,
  colors,
  defaultOpen = false,
  badge = null,            // başlığın yanında küçük sayaç/etiket
  containerStyle = null,
  headerStyle = null,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={containerStyle}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        hitSlop={8}
        style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, headerStyle]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title} bölümünü ${open ? 'kapat' : 'aç'}`}
      >
        <Text style={titleStyle}>{title}</Text>
        {badge}
        <View style={{ flex: 1 }} />
        <Text style={{ color: colors.textDim, fontSize: 12, fontWeight: '800' }}>
          {open ? '▲' : '▼'}
        </Text>
      </Pressable>

      {open && <View>{children}</View>}
    </View>
  );
}
