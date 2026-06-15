// Düz kategori listesini (parent_id'li) ana kategori -> alt kategoriler ağacına çevirir.
// API /categories/ çıktısı: [{ id, name, parent_id }]
export function groupCategories(flat = []) {
  const parents = flat.filter((c) => c.parent_id == null);
  const childrenByParent = {};
  for (const c of flat) {
    if (c.parent_id != null) {
      (childrenByParent[c.parent_id] ||= []).push(c);
    }
  }
  return parents.map((p) => ({ ...p, children: childrenByParent[p.id] || [] }));
}

// Sadece ana kategoriler.
export function parentsOnly(flat = []) {
  return flat.filter((c) => c.parent_id == null);
}

// id -> kategori sözlüğü.
export function byId(flat = []) {
  return Object.fromEntries(flat.map((c) => [c.id, c]));
}
