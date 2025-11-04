export const vec3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => vec3(a.x + b.x, a.y + b.y, (a.z || 0) + (b.z || 0));
export const sub = (a, b) => vec3(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
export const dot = (a, b) => (a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0));
export const length = (v) => Math.hypot(v.x, v.y, v.z || 0);
export const normalize = (v) => { const L = length(v) || 1; return vec3(v.x / L, v.y / L, (v.z || 0) / L); };
export const mul = (v, s) => vec3(v.x * s, v.y * s, (v.z || 0) * s);
export const angleBetween = (a, b) => {
    const na = normalize(a), nb = normalize(b);
    return Math.acos(Math.min(1, Math.max(-1, dot(na, nb))));
};
// 좌표 회전(간단 합성)
export function rotateZXY(v, rz, rx, rz2) {
    // Rz(rz) → Rx(rx) → Rz(rz2)
    const cz = Math.cos, sz = Math.sin;
    let x = v.x, y = v.y, z = v.z || 0;

    // Rz(rz)
    let x1 = x * cz(rz) - y * sz(rz);
    let y1 = x * sz(rz) + y * cz(rz);
    let z1 = z;

    // Rx(rx)
    let x2 = x1;
    let y2 = y1 * cz(rx) - z1 * sz(rx);
    let z2 = y1 * sz(rx) + z1 * cz(rx);

    // Rz(rz2)
    let x3 = x2 * cz(rz2) - y2 * sz(rz2);
    let y3 = x2 * sz(rz2) + y2 * cz(rz2);
    let z3 = z2;

    return { x: x3, y: y3, z: z3 };
}
