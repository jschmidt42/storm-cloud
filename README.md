Stingray Storm Cloud
--------------------

### Requirements

- Install [node.js 4.6.0 LTS](https://nodejs.org/en/)
- Compile a Stingray build:
 > ./make.rb --use-scaleform --use-navigation --use-crowdplayback --output "G:/stingray/build/binaries"

### Setup Storm Cloud

- Install Storm Cloud dependencies
> npm install

### Run Storm Cloud

> node main.js --port 5656 --binaries "G:/stingray/build/binaries"

You should then read something like this:
```
Created httpService
Http server started on http://10.X9.YWZ.WY2:9011
Created runtimeService
Runtime: G:/stingray/build/binaries/engine/win64/dev/stingray_win64_dev.exe
Runtime core: G:/stingray/build/binaries
Packages: G:\storm_cloud\packages
Created applicationService
```

Then you can open a browser at [http://localhost:9011](http://localhost:9011).

### To upload a new project/application

You can either zip the sources of your project containing the `settings.ini` file or use the
 Stingray Editor deployment tool to create a Win64 build and zip the deployed folder.
 Once you have the zip file you can upload it on the main page. The first time you launch the application it
 will be compiled and then you'll be able to stream its content once the compilation is finished. 
