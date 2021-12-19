
const { GROUP_BROADCAST,
        GROUP_PREFIX   }  = require('extws-server/src/data');
const ExtWSDriver         = require('extws-server/src/driver');
const ExtWSClient         = require('extws-server/src/client');
const { Address6 }        = require('ip-address');
const { WebSocketServer } = require('ws');

class ExtWSOnWSDriver extends ExtWSDriver {
	constructor ({
		port,
		path,
		payload_max_length,
	}) {
		super();

		this._ws_server = new WebSocketServer({
			port,
			path,
			perMessageDeflate: false,
			maxPayload: payload_max_length,
		});
		this._subscriptions = new Map();

		this._ws_server.on(
			'connection',
			(ws_client, req) => {
				const client = new ExtWSOnWSClient(
					this,
					ws_client,
				);

				ws_client._extws = {
					id: client.id,
					subscriptions: new Set(),
				};

				this._subscribeClient(
					ws_client,
					GROUP_BROADCAST,
				);

				{
					const ip_string = req.socket.remoteAddress;

					let ip_address;
					if (ip_string.includes(':') === false) {
						ip_address = Address6.fromAddress4(ip_string);
					}
					else {
						ip_address = new Address6(ip_string);
					}

					client.remoteAddress = (ip_address.v4 ? ip_address.address4 : ip_address).address;
					client.remoteAddress6 = ip_address;
				}

				client.headers = req.headers;

				client.url = new URL(
					req.url,
					'ws://' + req.headers.host,
				);

				this._onConnect(client);

				ws_client.on(
					'message',
					(payload, is_binary) => {
						if (!is_binary) {
							this._onMessage(
								client,
								payload.toString(),
							);
						}
					},
				);

				ws_client.on(
					'close',
					() => {
						client.disconnect(
							true, // is_already_disconnected
						);
					},
				);
			},
		);
	}

	_subscribeClient (ws_client, channel) {
		if (this._subscriptions.has(channel) !== true) {
			this._subscriptions.set(
				channel,
				new Set(),
			);
		}
		this._subscriptions.get(channel).add(ws_client);

		if (ws_client._extws.subscriptions instanceof Set !== true) {
			ws_client._extws.subscriptions = new Set();
		}
		ws_client._extws.subscriptions.add(channel);
	}

	_unsubscribeClient (ws_client, channel) {
		if (this._subscriptions.has(channel)) {
			this._subscriptions.get(channel).delete(ws_client);
		}

		if (ws_client._extws.subscriptions instanceof Set) {
			ws_client._extws.subscriptions.delete(channel);
		}
	}

	publish (channel, payload) {
		if (this._subscriptions.has(channel)) {
			for (const ws_client of this._subscriptions.get(channel)) {
				ws_client.send(payload);
			}
		}
	}
}

module.exports = ExtWSOnWSDriver;

class ExtWSOnWSClient extends ExtWSClient {
	constructor (driver, ws_client) {
		super();

		this._driver = driver;
		this._ws_client = ws_client;
	}

	emit (payload) {
		try {
			this._ws_client.send(payload);
		}
		catch {
			this.disconnect();
		}
	}

	join (group_id) {
		try {
			this._driver._subscribeClient(
				this._ws_client,
				GROUP_PREFIX + group_id,
			);
		}
		catch {
			this.disconnect();
		}
	}

	leave (group_id) {
		try {
			this._driver._unsubscribeClient(
				this._ws_client,
				GROUP_PREFIX + group_id,
			);
		}
		catch {
			this.disconnect();
		}
	}

	disconnect (
		is_already_disconnected = false,
		hard = false,
	) {
		if (true === hard) {
			try {
				this._ws_client.terminate();
			}
			catch {}
		}
		else if (true !== is_already_disconnected) {
			try {
				this._ws_client.close();
			}
			catch {}
		}

		super.disconnect();
	}
}
