function test() {
    var x = <HL>true;
    var y;
    if (x) {
        y = declassify(x, <LH>);
    }
}
test();
