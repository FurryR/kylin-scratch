# Kylin compiler

A project precompiler based on Turbowarp compiler.

## Usage

Install the environment:
```bash
npm i
```

Run the tool:
```bash
node ./src/main.cjs "input.sb3" output.sb3
```

## Compatibility

This compiler works fine with most **basic** extensions.

However, advanced extensions such as `Extendable blocks`, `Dictionary` and `lpp` that requires block container will certainly break as Kylin removes it.

The Kylin compiler is not supposed to use with Gandi IDE. You are welcomed to **try** it but just do not publish projects compiled via Kylin on Gandi IDE.

You may need some extra configurations to use Kylin with your own extensions as I wondered whether extension manager works properly.

## Copyright

Copyright (c) FurryR 2024 inspired by @VeroFess, the project name comes from @F_Qilin on Twitter.

> 高校入試の直前にこれをプレセントとして、みんなにあげます。幸運が訪れるように。
