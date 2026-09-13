// Exports my own Golden Gate Bridge model (archive/models/golden-gate-bridge.usdz,
// not committed to this repository — its source and licence are unknown to me)
// to world-space buffers for scripts/render-golden-gate.mjs: positions and
// triangle indices as little-endian float32/uint32, plus a JSON list of meshes
// with their index ranges and bounds. Uses Apple's Model I/O, so it needs
// macOS with the command line tools.
// Usage: swiftc -O scripts/prepare-golden-gate.swift -o /tmp/prepare-golden-gate
//        /tmp/prepare-golden-gate archive/models/golden-gate-bridge.usdz <outdir>
import Foundation
import ModelIO
import simd
let args = CommandLine.arguments
let asset = MDLAsset(url: URL(fileURLWithPath: args[1]))
let meshes = asset.childObjects(of: MDLMesh.self) as! [MDLMesh]
func world(_ o: MDLObject) -> matrix_float4x4 {
  var m = matrix_identity_float4x4
  var cur: MDLObject? = o
  while let c = cur { if let t = c.transform { m = t.matrix * m }; cur = c.parent }
  return m
}
var positions = Data(), indices = Data()
var ranges: [[String: Any]] = []
var vertexBase: UInt32 = 0
var stats: [(String, Int, SIMD3<Float>, SIMD3<Float>)] = []
for mesh in meshes {
  let m = world(mesh)
  guard let pos = mesh.vertexAttributeData(forAttributeNamed: MDLVertexAttributePosition, as: .float3) else { continue }
  let n = mesh.vertexCount
  var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
  var buf = [Float](repeating: 0, count: n * 3)
  for i in 0..<n {
    let p = pos.dataStart.advanced(by: i * pos.stride).assumingMemoryBound(to: Float.self)
    let v = m * SIMD4<Float>(p[0], p[1], p[2], 1)
    buf[i*3] = v.x; buf[i*3+1] = v.y; buf[i*3+2] = v.z
    lo = simd_min(lo, SIMD3(v.x, v.y, v.z)); hi = simd_max(hi, SIMD3(v.x, v.y, v.z))
  }
  positions.append(buf.withUnsafeBufferPointer { Data(buffer: $0) })
  var tris = 0
  let indexStart = indices.count / 4
  for sub in (mesh.submeshes as? [MDLSubmesh]) ?? [] {
    let ib = sub.indexBuffer(asIndexType: .uInt32)
    let map = ib.map()
    let count = sub.indexCount
    var idx = [UInt32](repeating: 0, count: count)
    let src = map.bytes.assumingMemoryBound(to: UInt32.self)
    for i in 0..<count { idx[i] = src[i] + vertexBase }
    if sub.geometryType == .triangles { indices.append(idx.withUnsafeBufferPointer { Data(buffer: $0) }); tris += count / 3 }
  }
  ranges.append(["name": mesh.name, "indexStart": indexStart, "indexCount": indices.count / 4 - indexStart, "min": [lo.x, lo.y, lo.z], "max": [hi.x, hi.y, hi.z]])
  stats.append((mesh.name, tris, lo, hi))
  vertexBase += UInt32(n)
}
try positions.write(to: URL(fileURLWithPath: (args.count > 2 ? args[2] : ".") + "/golden-gate-positions.bin"))
try indices.write(to: URL(fileURLWithPath: (args.count > 2 ? args[2] : ".") + "/golden-gate-indices.bin"))
let json = try JSONSerialization.data(withJSONObject: ["meshes": ranges], options: [])
try json.write(to: URL(fileURLWithPath: (args.count > 2 ? args[2] : ".") + "/golden-gate-meshes.json"))
print("vertices", vertexBase, "indices", indices.count / 4)
let byName = Dictionary(grouping: stats, by: { $0.0.replacingOccurrences(of: "[_0-9]+$", with: "", options: .regularExpression) })
for (name, group) in byName.sorted(by: { $0.value.reduce(0) { $0 + $1.1 } > $1.value.reduce(0) { $0 + $1.1 } }).prefix(30) {
  let t = group.reduce(0) { $0 + $1.1 }
  var lo = SIMD3<Float>(repeating: .greatestFiniteMagnitude), hi = SIMD3<Float>(repeating: -.greatestFiniteMagnitude)
  for g in group { lo = simd_min(lo, g.2); hi = simd_max(hi, g.3) }
  print(String(format: "%-28@ meshes %5d tris %8d  x %.0f..%.0f  y %.0f..%.0f  z %.0f..%.0f", name as NSString, group.count, t, lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))
}
