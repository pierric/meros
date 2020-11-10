// @ts-nocheck

import type { IncomingMessage } from 'http';

// Mocks for Node@10
global['TextDecoder'] =
	global['TextDecoder '] ||
	class {
		decode(arr: Uint8Array) {
			let str = '';
			for (let i = 0; i < arr.length; i++) {
				str += String.fromCharCode(arr[i]);
			}
			return str;
		}
	};

export function makeChunk(
	payload: any,
	boundary: string,
	contentType: string = 'application/json',
) {
	const chunk = Buffer.from(contentType === 'text/plain' ? payload : JSON.stringify(payload), 'utf8');
	const returns = [
		'',
		`--${boundary}`,
		`Content-Type: ${contentType}`,
		'Content-Length: ' + String(chunk.length),
		'',
		chunk + '                                          ',
	];

	return returns.join('\r\n');
}

function* makePatches(
	parts: (string | object | (string | object)[])[],
	boundary: string,
) {
	const patches = parts.map((part) => {
		if (Array.isArray(part))
			return part
				.map((p) =>
					makeChunk(
						p,
						boundary,
						typeof p === 'string'
							? 'text/plain'
							: 'application/json',
					),
				)
				.join('');
		return makeChunk(
			part,
			boundary,
			typeof part === 'string' ? 'text/plain' : 'application/json',
		);
	});

	yield Buffer.from('preamble');

	for (const patch of patches) {
		const toSend = Math.ceil(patch.length / 9);
		for (let i = 0, o = 0; i < toSend; ++i, o += 9) {
			const ct = patch.substr(o, 9);
			yield Buffer.from(ct);
		}
	}

	yield Buffer.from(`\r\n--${boundary}--\r\n`);

	yield Buffer.from('epilogue');
	yield Buffer.from(makeChunk({ shouldnt: 'work' }, boundary));
}

export async function mockResponseNode(
	parts: (string | object | (string | object)[])[],
	boundary: string,
): Promise<IncomingMessage> {
	return {
		headers: {
			'content-type': `multipart/mixed; boundary=${boundary}`,
		},
		[Symbol.asyncIterator]: makePatches.bind(null, parts, boundary),
	};
}

export async function mockResponseBrowser(
	parts: (string | object | (string | object)[])[],
	boundary: string,
): Promise<Response> {
	return {
		headers: new Map([
			['content-type', `multipart/mixed; boundary=${boundary}`],
			['Content-Type', `multipart/mixed; boundary=${boundary}`],
		]),
		status: 200,
		body: {
			getReader() {
				const patches = makePatches(parts, boundary);
				return {
					async read() {
						return patches.next();
					},
					releaseLock() {
						// nothing
					},
				};
			},
		},
		ok: true,
		bodyUsed: false,
	};
}
