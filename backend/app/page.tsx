import Nav from "./components/Nav";
import Hero from "./components/Hero";
import UseCases from "./components/UseCases";
import HowToInstall from "./components/HowToInstall";
import Footer from "./components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <UseCases />
        <HowToInstall />
      </main>
      <Footer />
    </>
  );
}
