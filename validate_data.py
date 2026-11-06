"""Verify deployable browser arrays against their release manifest."""
import gzip
import hashlib
import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent / 'data'
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    checked = 0
    for lineage, meta in manifest['lineages'].items():
        names = ['coords', 'attributes', 'matched', 'source_rows']
        if 'clone_expansion' in manifest:
            names.extend(['clone_unit', 'clone_size'])
        for name in names:
            descriptor = meta['files'][name]
            path = (root / lineage / descriptor['path']).resolve()
            if not path.is_relative_to(root.resolve()):
                raise ValueError('Invalid data path')
            raw = gzip.decompress(path.read_bytes())
            if len(raw) != descriptor['bytes']:
                raise ValueError(f'Wrong array size: {path}')
            if hashlib.sha256(raw).hexdigest() != descriptor['sha256']:
                raise ValueError(f'Wrong array checksum: {path}')
            checked += 1
    print(f'DATA_OK: {checked} browser arrays; CD4 and CD8')


if __name__ == '__main__':
    main()
