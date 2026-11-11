import { Button, CloseButton, Col, Form, Row } from "react-bootstrap";
import { newOidRow } from "@/features/snmp";

const AUTH_PROTOS = ["none", "MD5", "SHA", "SHA256"];
const PRIV_PROTOS = ["none", "DES", "AES128", "AES256"];
const OPS = [">", ">=", "<", "<=", "==", "!="];

export default function SnmpTab({ value, onChange, current }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
  const setOid = (i, key, v) =>
    onChange({ ...value, oids: value.oids.map((row, j) => (j === i ? { ...row, [key]: v } : row)) });
  const off = value.version === "off";

  const secret = (key, label, has) => (
    <Form.Group className="mb-3" controlId={`snmp-${key}`}>
      <Form.Label>{label}</Form.Label>
      <Form.Control
        type="password"
        autoComplete="new-password"
        value={value[key]}
        onChange={set(key)}
        placeholder={has ? "unchanged" : ""}
      />
    </Form.Group>
  );

  return (
    <div>
      <Form.Group className="mb-3" role="radiogroup" aria-label="SNMP version">
        {[
          ["off", "Off"],
          ["v2c", "v2c"],
          ["v3", "v3"],
        ].map(([v, label]) => (
          <Form.Check
            inline
            type="radio"
            key={v}
            id={`snmp-version-${v}`}
            name="snmp-version"
            label={label}
            checked={value.version === v}
            onChange={() => onChange({ ...value, version: v })}
          />
        ))}
      </Form.Group>

      {!off && (
        <>
          <Row>
            <Col xs={4}>
              <Form.Group className="mb-3" controlId="snmp-port">
                <Form.Label>Port</Form.Label>
                <Form.Control type="number" min={1} max={65535} value={value.port} onChange={set("port")} />
              </Form.Group>
            </Col>
          </Row>

          {value.version === "v2c" && secret("community", "Community", current?.has_community)}

          {value.version === "v3" && (
            <>
              <Form.Group className="mb-3" controlId="snmp-user">
                <Form.Label>User</Form.Label>
                <Form.Control value={value.user} onChange={set("user")} autoComplete="off" />
              </Form.Group>
              <Row>
                <Col xs={5}>
                  <Form.Group className="mb-3" controlId="snmp-authProto">
                    <Form.Label>Auth protocol</Form.Label>
                    <Form.Select value={value.authProto} onChange={set("authProto")}>
                      {AUTH_PROTOS.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col xs={7}>{secret("authKey", "Auth key", current?.has_auth_key)}</Col>
              </Row>
              <Row>
                <Col xs={5}>
                  <Form.Group className="mb-3" controlId="snmp-privProto">
                    <Form.Label>Privacy protocol</Form.Label>
                    <Form.Select value={value.privProto} onChange={set("privProto")}>
                      {PRIV_PROTOS.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col xs={7}>{secret("privKey", "Privacy key", current?.has_priv_key)}</Col>
              </Row>
            </>
          )}

          <Form.Check
            type="switch"
            id="snmp-uptime"
            className="mb-2"
            label="Watch uptime (reboots)"
            checked={value.uptime}
            onChange={(e) => onChange({ ...value, uptime: e.target.checked })}
          />
          <Form.Check
            type="switch"
            id="snmp-interfaces"
            className="mb-2"
            label="Watch interfaces"
            checked={value.interfaces}
            onChange={(e) => onChange({ ...value, interfaces: e.target.checked })}
          />
          {value.interfaces && (
            <Form.Group className="mb-3" controlId="snmp-ifIndexes">
              <Form.Label>Interface indexes (optional)</Form.Label>
              <Form.Control
                value={value.ifIndexes}
                onChange={set("ifIndexes")}
                placeholder="all interfaces, or e.g. 1, 2, 24"
              />
            </Form.Group>
          )}

          <h3 className="h6 mt-3">Custom OIDs</h3>
          {value.oids.map((row, i) => (
            <Row key={i} className="g-2 mb-2 align-items-center">
              <Col xs={12} sm={4}>
                <Form.Control
                  aria-label={`OID ${i + 1}`}
                  className="font-monospace"
                  placeholder="1.3.6.1.2.1..."
                  value={row.oid}
                  onChange={(e) => setOid(i, "oid", e.target.value)}
                />
              </Col>
              <Col xs={6} sm={3}>
                <Form.Control
                  aria-label={`OID ${i + 1} label`}
                  placeholder="Label"
                  value={row.label}
                  onChange={(e) => setOid(i, "label", e.target.value)}
                />
              </Col>
              <Col xs={6} sm={2}>
                <Form.Select aria-label={`OID ${i + 1} mode`} value={row.mode} onChange={(e) => setOid(i, "mode", e.target.value)}>
                  <option value="change">Change</option>
                  <option value="threshold">Threshold</option>
                </Form.Select>
              </Col>
              {row.mode === "threshold" ? (
                <>
                  <Col xs={3} sm={1}>
                    <Form.Select aria-label={`OID ${i + 1} operator`} value={row.op} onChange={(e) => setOid(i, "op", e.target.value)}>
                      {OPS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </Form.Select>
                  </Col>
                  <Col xs={7} sm={1}>
                    <Form.Control aria-label={`OID ${i + 1} value`} value={row.value} onChange={(e) => setOid(i, "value", e.target.value)} />
                  </Col>
                </>
              ) : (
                <Col xs={10} sm={2} />
              )}
              <Col xs={2} sm={1} className="text-end">
                <CloseButton aria-label={`Remove OID ${i + 1}`} onClick={() => onChange({ ...value, oids: value.oids.filter((_, j) => j !== i) })} />
              </Col>
            </Row>
          ))}
          <Button variant="outline-primary" size="sm" onClick={() => onChange({ ...value, oids: [...value.oids, newOidRow()] })}>
            Add OID
          </Button>
        </>
      )}
    </div>
  );
}
