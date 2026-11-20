"""Verify deployable browser arrays against their release manifest."""
import gzip
import hashlib
import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent / 'data'
    catalog = json.loads((root / 'datasets.json').read_text(encoding='utf-8'))
    if catalog['version'] != 1 or not catalog['datasets']:
        raise ValueError('Invalid dataset catalog')
    ids = [item['id'] for item in catalog['datasets']]
    if len(set(ids)) != len(ids) or catalog['default'] not in ids:
        raise ValueError('Invalid dataset identity')
    checked = 0
    for dataset in catalog['datasets']:
        manifest_path = (root / dataset['manifest']).resolve()
        if not manifest_path.is_relative_to(root.resolve()):
            raise ValueError('Invalid manifest path')
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest['version'] != 1 or set(manifest['lineages']) != {'CD4', 'CD8'}:
            raise ValueError(f'Invalid manifest: {manifest_path}')
        for lineage, meta in manifest['lineages'].items():
            shapes = {'coords': [meta['cells'], 2], 'attributes': [meta['cells'], len(manifest['attributes'])],
                      'matched': [meta['cells']], 'source_rows': [meta['cells']]}
            for name, shape in shapes.items():
                descriptor = meta['files'][name]
                path = (manifest_path.parent / lineage / descriptor['path']).resolve()
                if not path.is_relative_to(manifest_path.parent):
                    raise ValueError('Invalid data path')
                if descriptor['shape'] != shape:
                    raise ValueError(f'Wrong array shape: {path}')
                raw = gzip.decompress(path.read_bytes())
                if len(raw) != descriptor['bytes']:
                    raise ValueError(f'Wrong array size: {path}')
                if hashlib.sha256(raw).hexdigest() != descriptor['sha256']:
                    raise ValueError(f'Wrong array checksum: {path}')
                checked += 1
        print(f"DATASET_OK: {dataset['id']}; CD4 and CD8")
    print(f'DATA_OK: {checked} browser arrays; {len(ids)} datasets')


if __name__ == '__main__':
    main()
