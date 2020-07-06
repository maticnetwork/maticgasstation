#!/usr/bin/python3

from __future__ import annotations
from typing import Dict, List
from os.path import exists
from json import load
from functools import reduce
from math import ceil


def validateConfig(config: Dict[str, int]) -> bool:
    '''
        Given parsed content of config file, validates it
        and returns true on success, else false
    '''
    def _validateThreshold(key: str) -> bool:
        return config[key] >= 0 and config[key] <= 100

    def _sumsTo100(keys: List[str]) -> bool:
        return ceil(reduce(lambda acc, cur: acc + config[cur], keys, 0)) == 100

    if not config:
        return False

    try:
        return _validateThreshold('safelow') and\
            _validateThreshold('standard') and\
            _validateThreshold('fast') and\
            _sumsTo100(['safelow', 'standard', 'fast'])
    except Exception:
        return False


def parseConfig(src: str) -> Dict[str, int]:
    '''
        Given path to config file, returns a dictionary
        holding keys and corresponding values
    '''
    if not exists(src):
        return None

    try:
        _config = None
        with open(src, 'r') as fd:
            _config = load(fd)

        if not _config:
            return None

        return _config
    except Exception:
        return None


if __name__ == '__main__':
    print('It is not supposed to be used that way !')