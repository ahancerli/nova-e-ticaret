import type { Connector, ConnectorRegistry } from "../../application/ports";
import { NetgsmConnector } from "./netgsm";
import { ParasutConnector } from "./parasut";
import { YurticiConnector } from "./yurtici";

/**
 * Adapters shipped with the app. A firm becomes selectable when it is here AND its integration_providers row is
 * 'ready' (db/schema.sql). New firm = one connector class + its catalog row with credential_fields_json.
 */
export function defaultConnectors(): ConnectorRegistry {
  const list: Connector[] = [new YurticiConnector(), new NetgsmConnector(), new ParasutConnector()];
  return new Map(list.map((c) => [c.code, c]));
}
