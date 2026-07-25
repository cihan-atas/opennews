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
  open: openProp,          // kontrollü mod: durumu dışarıdan yönet
  onToggle,                //   (yeniDeger) => void
  badge = null,            // başlığın yanında küçük sayaç/etiket
  containerStyle = null,
  headerStyle = null,
  children,
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);

  // Kapalıyken children DOM'dan kalkar; iç içe kullanımda çocuk bölümlerin
  // açık/kapalı durumu bu yüzden kaybolur. Kontrollü modda durum ebeveynde
  // tutulur ve hatırlanır (bkz. SettingsScreen → openGroups).
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  const toggle = () => {
    if (isControlled) onToggle?.(!open);
    else setInternalOpen((o) => !o);
  };

  return (
    <View style={containerStyle}>
      <Pressable
        onPress={toggle}
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
