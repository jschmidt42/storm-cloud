Stingray Storm Cloud
--------------------

### Requirements

- Install [node.js 4.6.0 LTS](https://nodejs.org/en/)

### Compile

- Compile Stingray
> ./make.rb --use-scaleform --use-navigation --use-crowdplayback --output "G:/stingray/build/binaries"

- Install Storm Cloud dependencies
> npm install

### Run Storm Cloud

> node main.js --port 5656 --binaries "G:/stingray/build/binaries"
